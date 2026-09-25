/**
 * Case- and accent-insensitive text matching without the `unaccent`
 * extension, so it works on any Postgres database, including dev databases
 * built by `synchronize` that never run migrations.
 *
 * Accented Latin letters fold to their base letter, as do letters with no
 * decomposition that users still type as plain ones, such as ø, ł and the
 * Twi/Ga letters ɛ and ɔ. The same table is used in SQL and in JavaScript so a
 * search term and the column it is matched against always fold alike.
 */
const FOLD_FROM =
  'àáâãäåçèéêëìíîïñòóôõöùúûüýÿāăąćĉċčďēĕėęěĝğġģĥĩīĭįĵķĺļľńņňōŏőŕŗřśŝşšţťũūŭůűųŵŷźżžơưǎǐǒǔǖǘǚǜǟǡǧǩǫǭǰǵǹǻȁȃȅȇȉȋȍȏȑȓȕȗșțȟȧȩȫȭȯȱȳøđłħŧŋɛɔ';
const FOLD_TO =
  'aaaaaaceeeeiiiinooooouuuuyyaaaccccdeeeeegggghiiiijklllnnnooorrrssssttuuuuuuwyzzzouaiouuuuuaagkoojgnaaaeeiioorruusthaeooooyodlhtneo';

const FOLD_MAP = new Map(
  [...FOLD_FROM].map((char, index) => [char, FOLD_TO[index]]),
);

/** Lowercase and strip accents from a string. */
export function foldText(text: string): string {
  return [...text.normalize('NFC').toLowerCase()]
    .map((char) => FOLD_MAP.get(char) ?? char)
    .join('');
}

/** The SQL equivalent of {@link foldText} applied to `expression`. */
export function foldSql(expression: string): string {
  return `translate(lower(${expression}), '${FOLD_FROM}', '${FOLD_TO}')`;
}

/** Escape LIKE wildcards so user input only ever matches literally. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}
