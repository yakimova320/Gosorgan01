/** Письмо в ответе API. Без путей и ключей хранения файлов. */
export interface LetterView {
  id: string;
  caseId: string | null;
  sourceType: 'PDF_TEXT' | 'IMAGE';
  text: string;
  pages: { n: number; readable: boolean; chars: number }[];
  files: { n: number; mime: string; bytes: number }[];
  createdAt: string;
}

/** Ответ POST /letters (ТЗ v2 раздел 8 пункт 7). Факты и подсказки появятся в B06. */
export interface UploadLetterResponse {
  letter: LetterView;
  claims: unknown[];
  deadlines: unknown[];
  suggestions: { caseId: string; title: string; reason: string }[];
}
