import pdfMake from 'pdfmake/build/pdfmake';
import fonts from 'pdfmake/build/vfs_fonts';
import { buildPdfDocument } from './pdf-document';
import type { ExportConversation, ExportLabels } from './export-document';

pdfMake.addVirtualFileSystem(fonts);
pdfMake.addFonts({ Mono: { normal: 'Mono.ttf', bold: 'Mono.ttf', italics: 'Mono.ttf', bolditalics: 'Mono.ttf' } });
let fontReady: Promise<void> | undefined;
async function loadFont() {
  const response = await fetch(chrome.runtime.getURL('/pdf-fonts/LiberationMono-Regular.ttf'));
  if (!response.ok) throw new Error('Could not load the bundled PDF font');
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  pdfMake.addVirtualFileSystem({ 'Mono.ttf': btoa(binary) });
}

async function pngData(data: string): Promise<string> {
  const image = new Image();
  image.src = data;
  await image.decode();
  const scale = Math.min(1, 1800 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

export async function createDownloadPdf(source: ExportConversation, labels: ExportLabels): Promise<{ blob: Blob; missingImages: number }> {
  // Converting images for PDF must not mutate the HTML preview's source data.
  const chat = structuredClone(source);
  let missingImages = 0;
  for (const message of chat.messages) for (const image of message.images) {
    if (image.data) {
      try { image.data = await pngData(image.data); } catch { image.data = undefined; }
    }
    if (!image.data) missingImages++;
  }
  fontReady ??= loadFont().catch(error => { fontReady = undefined; throw error; });
  await fontReady;
  return { blob: await pdfMake.createPdf(buildPdfDocument(chat, labels)).getBlob(), missingImages };
}
