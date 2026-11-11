export interface DocumentPage {
  text: string;
  confidence: number;
}
export interface ParsedDocument {
  text: string;
  pages: DocumentPage[];
  source: 'TEXT_LAYER' | 'OCR';
  sourceType: 'PDF_TEXT' | 'PDF_SCAN' | 'IMAGE';
  readable: boolean;
  ocrConfidence?: number;
  reason?: string;
}
export interface Upload {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}
