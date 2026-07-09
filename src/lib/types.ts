// Tipo di filtro applicato alla pagina scansionata.
export type Filter = 'color' | 'enhance' | 'bw';

// Un documento salvato nell'archivio (i Blob restano dentro IndexedDB).
export type ScanDoc = {
  id: string;
  name: string;
  createdAt: number; // Date.now()
  pageCount: number;
  pdf: Blob;
  thumb: Blob;
  size: number; // byte del PDF
  synced?: boolean; // true se già caricato sul cloud
};

// Criteri di ordinamento dell'archivio.
export type SortKey = 'date_desc' | 'date_asc' | 'name_asc' | 'name_desc';
