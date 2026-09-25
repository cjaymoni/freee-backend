import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * One searcher searching one term on one day, kept only to rank popular
 * terms. Holds no user ID or IP: `searcher_hash` is a salted hash that
 * changes every day, so rows cannot be tied to a person or linked across days.
 */
@Entity('search_queries')
@Index('UQ_SEARCH_QUERIES_TERM_SEARCHER', ['term', 'searcher_hash'], {
  unique: true,
})
@Index('idx_search_queries_created_at', ['created_at'])
export class SearchQueryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  term: string;

  @Column({ type: 'varchar', length: 64 })
  searcher_hash: string;

  @CreateDateColumn()
  created_at: Date;
}
