import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CategoryEntity } from './entities/category.entity';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CategoryResponseDto } from './dto/category-response.dto';
import { ServiceResponseDto } from '../common/service-response.dto';

@Injectable()
export class CategoryService {
  constructor(
    @InjectRepository(CategoryEntity)
    private readonly categoryRepository: Repository<CategoryEntity>,
  ) {}

  /**
   * Make `slug` available to a new or renamed category. The column is unique
   * across every row, deleted ones included, so a soft-deleted category that
   * still holds the slug gives it up by moving to a slug suffixed with its own
   * id. A live holder is a real conflict.
   */
  private async claimSlug(slug: string, forId?: string): Promise<void> {
    const holder = await this.categoryRepository.findOne({ where: { slug } });
    if (!holder || holder.id === forId) return;

    if (!holder.is_deleted) {
      throw new ConflictException(
        `Category with slug '${slug}' already exists`,
      );
    }

    // 100 is the column length; the suffix is "~" plus a 36-char uuid.
    await this.categoryRepository.update(holder.id, {
      slug: `${slug.slice(0, 100 - 37)}~${holder.id}`,
    });
  }

  /**
   * Refuse a parent that sits below `categoryId`: A under B under A would
   * leave neither top-level, and the list only returns top-level categories,
   * so both would vanish from the app and the backoffice.
   */
  private async assertNotDescendant(
    parentId: string,
    categoryId: string,
  ): Promise<void> {
    const seen = new Set<string>();
    let currentId: string | null = parentId;
    while (currentId && !seen.has(currentId)) {
      if (currentId === categoryId) {
        throw new BadRequestException(
          'A category cannot be moved under one of its own subcategories',
        );
      }
      seen.add(currentId);
      const current = await this.categoryRepository.findOne({
        where: { id: currentId },
        select: { id: true, parent_category_id: true },
      });
      currentId = current?.parent_category_id ?? null;
    }
  }

  /**
   * Create a new category
   */
  async create(
    createDto: CreateCategoryDto,
  ): Promise<ServiceResponseDto<CategoryResponseDto>> {
    await this.claimSlug(createDto.slug);

    // Validate parent category exists if provided
    if (createDto.parent_category_id) {
      const parent = await this.categoryRepository.findOne({
        where: { id: createDto.parent_category_id, is_deleted: false },
      });

      if (!parent) {
        throw new NotFoundException(
          `Parent category with ID ${createDto.parent_category_id} not found`,
        );
      }
    }

    const category = this.categoryRepository.create(createDto);
    const saved = await this.categoryRepository.save(category);

    return {
      message: 'Category created successfully',
      data: CategoryResponseDto.fromEntity(saved),
      state: true,
      statusCode: 201,
    };
  }

  /**
   * Get all categories (optionally only active ones)
   */
  async findAll(
    onlyActive = true,
    includeSubcategories = true,
  ): Promise<ServiceResponseDto<CategoryResponseDto[]>> {
    const query = this.categoryRepository
      .createQueryBuilder('category')
      .leftJoinAndSelect(
        'category.subcategories',
        'subcategories',
        onlyActive
          ? 'subcategories.is_deleted = false AND subcategories.is_active = true'
          : 'subcategories.is_deleted = false',
      )
      .loadRelationCountAndMap(
        'category.item_count',
        'category.items',
        'item',
        (qb) => qb.andWhere('item.is_deleted = false'),
      )
      .where('category.is_deleted = :is_deleted', { is_deleted: false })
      .andWhere('category.parent_category_id IS NULL');

    if (onlyActive) {
      query.andWhere('category.is_active = :is_active', { is_active: true });
    }

    query.orderBy('category.display_order', 'ASC', 'NULLS LAST');
    query.addOrderBy('category.name', 'ASC');

    if (includeSubcategories) {
      query.addOrderBy('subcategories.display_order', 'ASC', 'NULLS LAST');
      query.addOrderBy('subcategories.name', 'ASC');
    }

    const categories = await query.getMany();

    return {
      message: 'Categories retrieved successfully',
      data: categories.map((category) =>
        CategoryResponseDto.fromEntity(category, includeSubcategories),
      ),
      state: true,
      statusCode: 200,
    };
  }

  /**
   * Get a single category by ID
   */
  async findOne(id: string): Promise<ServiceResponseDto<CategoryResponseDto>> {
    const category = await this.categoryRepository.findOne({
      where: { id, is_deleted: false },
      relations: ['subcategories', 'parentCategory'],
    });

    if (!category) {
      throw new NotFoundException(`Category with ID ${id} not found`);
    }

    // Relations load unfiltered; show the same children the public list does.
    category.subcategories = category.subcategories?.filter(
      (sub) => !sub.is_deleted && sub.is_active,
    );

    return {
      message: 'Category retrieved successfully',
      data: CategoryResponseDto.fromEntity(category, true),
      state: true,
      statusCode: 200,
    };
  }

  /**
   * Get a category by slug
   */
  async findBySlug(
    slug: string,
  ): Promise<ServiceResponseDto<CategoryResponseDto>> {
    const category = await this.categoryRepository.findOne({
      where: { slug, is_deleted: false },
      relations: ['subcategories', 'parentCategory'],
    });

    if (!category) {
      throw new NotFoundException(`Category with slug '${slug}' not found`);
    }

    // Relations load unfiltered; show the same children the public list does.
    category.subcategories = category.subcategories?.filter(
      (sub) => !sub.is_deleted && sub.is_active,
    );

    return {
      message: 'Category retrieved successfully',
      data: CategoryResponseDto.fromEntity(category, true),
      state: true,
      statusCode: 200,
    };
  }

  /**
   * Update a category
   */
  async update(
    id: string,
    updateDto: UpdateCategoryDto,
  ): Promise<ServiceResponseDto<CategoryResponseDto>> {
    const category = await this.categoryRepository.findOne({
      where: { id, is_deleted: false },
    });

    if (!category) {
      throw new NotFoundException(`Category with ID ${id} not found`);
    }

    if (updateDto.slug && updateDto.slug !== category.slug) {
      await this.claimSlug(updateDto.slug, id);
    }

    // Validate parent category if being updated
    if (updateDto.parent_category_id) {
      // Prevent circular references
      if (updateDto.parent_category_id === id) {
        throw new BadRequestException('Category cannot be its own parent');
      }
      await this.assertNotDescendant(updateDto.parent_category_id, id);

      const parent = await this.categoryRepository.findOne({
        where: { id: updateDto.parent_category_id, is_deleted: false },
      });

      if (!parent) {
        throw new NotFoundException(
          `Parent category with ID ${updateDto.parent_category_id} not found`,
        );
      }
    }

    Object.assign(category, updateDto);
    const updated = await this.categoryRepository.save(category);

    return {
      message: 'Category updated successfully',
      data: CategoryResponseDto.fromEntity(updated),
      state: true,
      statusCode: 200,
    };
  }

  /**
   * Soft delete a category
   */
  async remove(id: string): Promise<ServiceResponseDto<CategoryResponseDto>> {
    const category = await this.categoryRepository.findOne({
      where: { id, is_deleted: false },
      relations: ['subcategories'],
    });

    if (!category) {
      throw new NotFoundException(`Category with ID ${id} not found`);
    }

    // Check if category has active subcategories
    const hasActiveSubcategories = category.subcategories?.some(
      (sub) => !sub.is_deleted,
    );

    if (hasActiveSubcategories) {
      throw new BadRequestException(
        'Cannot delete category with active subcategories. Delete or reassign subcategories first.',
      );
    }

    category.is_deleted = true;
    category.deleted_at = new Date();

    const deleted = await this.categoryRepository.save(category);
    return {
      message: 'Category deleted successfully',
      data: CategoryResponseDto.fromEntity(deleted),
      state: true,
      statusCode: 200,
    };
  }

  /**
   * Toggle category active status
   */
  async toggleActive(
    id: string,
  ): Promise<ServiceResponseDto<CategoryResponseDto>> {
    const category = await this.categoryRepository.findOne({
      where: { id, is_deleted: false },
    });

    if (!category) {
      throw new NotFoundException(`Category with ID ${id} not found`);
    }

    category.is_active = !category.is_active;
    const updated = await this.categoryRepository.save(category);

    return {
      message: `Category ${category.is_active ? 'activated' : 'deactivated'} successfully`,
      data: CategoryResponseDto.fromEntity(updated),
      state: true,
      statusCode: 200,
    };
  }
}
