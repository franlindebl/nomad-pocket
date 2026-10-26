// Which archives outside the curated catalog carry medical content, so the reader shows the
// "information, not medical advice" banner for them too (Explore downloads and Files imports).
// Conservative on purpose: Kiwix tags, the Kiwix category, or whole words of the book name.

/** Whole words (a name is split on _ - . and spaces) that only medical books use. */
const MEDICAL_WORDS = new Set([
  'medicine',
  'medicines',
  'medical',
  'medicina',
  'medlineplus',
  'mdwiki',
  'wikem',
  'librepathology',
  'pathology',
  'nhs',
  'cdc',
]);

const MEDICAL_TAGS = new Set(['medical', 'medicine']);

export type MedicalHints = {
  /** Book name, file name stem or catalog id: "wikipedia_fr_medicine_maxi", "mdwiki_en_all". */
  names?: (string | null | undefined)[];
  /** Kiwix category ("medicine") or the catalog's. */
  category?: string | null;
  /** Public Kiwix tags ("medical"). */
  tags?: string[];
};

export function looksMedical({ names = [], category, tags = [] }: MedicalHints): boolean {
  if (category && MEDICAL_TAGS.has(category.trim().toLowerCase())) return true;
  if (tags.some((tag) => MEDICAL_TAGS.has(tag.trim().toLowerCase()))) return true;
  return names.some(
    (n) =>
      !!n &&
      n
        .toLowerCase()
        .split(/[\s_.-]+/)
        .some((w) => MEDICAL_WORDS.has(w)),
  );
}
