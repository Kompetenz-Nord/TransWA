export async function downloadVerifiedZip(url: string, fileName: string): Promise<void> {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Download fehlgeschlagen (HTTP ${response.status}).`);
  }

  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  // Verify standard PK\x03\x04 ZIP magic header so HTML fallbacks can never be saved as .zip
  if (bytes.byteLength < 30 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error('Server hat kein gültiges ZIP-Archiv geliefert.');
  }

  const blob = new Blob([buffer], { type: 'application/zip' });
  const objectUrl = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = fileName;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } finally {
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
  }
}
