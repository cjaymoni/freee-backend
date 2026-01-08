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

@Injectable()
export class CategoryService {
  constructor(
    @InjectRepository(CategoryEntity)
    private readonly categoryRepository: Repository<CategoryEntity>,
  ) {}

  /**
   * Create a new category
   */
  async create(createDto: CreateCategoryDto): Promise<CategoryResponseDto> {
    // Check if slug already exists
    const existing = await this.categoryRepository.findOne({
      where: { slug: createDto.slug, is_deleted: false },
    });

    if (existing) {
      throw new ConflictException(
        `Category with slug '${createDto.slug}' already exists`,
      );
    }

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

    return CategoryResponseDto.fromEntity(saved);
  }

  /**
   * Get all categories (optionally only active ones)
   */
  async findAll(
    onlyActive = true,
    includeSubcategories = true,
  ): Promise<CategoryResponseDto[]> {
    const query = this.categoryRepository
      .createQueryBuilder('category')
      .leftJoinAndSelect('category.subcategories', 'subcategories')
      .loadRelationCountAndMap('category.items', 'category.items')
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

    return categories.map((category) =>
      CategoryResponseDto.fromEntity(category, includeSubcategories),
    );
  }

  /**
   * Get a single category by ID
   */
  async findOne(id: string): Promise<CategoryResponseDto> {
    const category = await this.categoryRepository.findOne({
      where: { id, is_deleted: false },
      relations: ['subcategories', 'parentCategory'],
    });

    if (!category) {
      throw new NotFoundException(`Category with ID ${id} not found`);
    }

    return CategoryResponseDto.fromEntity(category, true);
  }

  /**
   * Get a category by slug
   */
  async findBySlug(slug: string): Promise<CategoryResponseDto> {
    const category = await this.categoryRepository.findOne({
      where: { slug, is_deleted: false },
      relations: ['subcategories', 'parentCategory'],
    });

    if (!category) {
      throw new NotFoundException(`Category with slug '${slug}' not found`);
    }

    return CategoryResponseDto.fromEntity(category, true);
  }

  /**
   * Update a category
   */
  async update(
    id: string,
    updateDto: UpdateCategoryDto,
  ): Promise<CategoryResponseDto> {
    const category = await this.categoryRepository.findOne({
      where: { id, is_deleted: false },
    });

    if (!category) {
      throw new NotFoundException(`Category with ID ${id} not found`);
    }

    // Check slug uniqueness if being updated
    if (updateDto.slug && updateDto.slug !== category.slug) {
      const existing = await this.categoryRepository.findOne({
        where: { slug: updateDto.slug, is_deleted: false },
      });

      if (existing) {
        throw new ConflictException(
          `Category with slug '${updateDto.slug}' already exists`,
        );
      }
    }

    // Validate parent category if being updated
    if (updateDto.parent_category_id) {
      // Prevent circular references
      if (updateDto.parent_category_id === id) {
        throw new BadRequestException('Category cannot be its own parent');
      }

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

    return CategoryResponseDto.fromEntity(updated);
  }

  /**
   * Soft delete a category
   */
  async remove(id: string): Promise<CategoryResponseDto> {
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
    return CategoryResponseDto.fromEntity(deleted);
  }

  /**
   * Toggle category active status
   */
  async toggleActive(id: string): Promise<CategoryResponseDto> {
    const category = await this.categoryRepository.findOne({
      where: { id, is_deleted: false },
    });

    if (!category) {
      throw new NotFoundException(`Category with ID ${id} not found`);
    }

    category.is_active = !category.is_active;
    const updated = await this.categoryRepository.save(category);

    return CategoryResponseDto.fromEntity(updated);
  }
}
