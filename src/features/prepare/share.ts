// Exports the plan as an A4 PDF and opens the share sheet (print, save to Files, AirDrop…).
import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import { formatCoords } from '@/features/maps/markers';
import i18n from '@/i18n';

import { A4, planDocument } from './document';
import { kitGroups } from './rows';
import { usePrepare } from './store';

export async function sharePlanPdf() {
  const t = i18n.getFixedT(null, 'prepare');
  const data = usePrepare.getState();
  const html = planDocument({
    data,
    kit: kitGroups(data, t).map((g) => ({
      title: g.title,
      items: g.rows.map((r) => ({ title: r.title, detail: r.detail, have: r.entry.have })),
    })),
    t,
    formatCoords,
    generatedAt: new Date().toLocaleDateString(i18n.language, { day: 'numeric', month: 'long', year: 'numeric' }),
  });
  const { uri } = await Print.printToFileAsync({ html, ...A4 });
  // printToFileAsync names the file with a UUID: give it a readable name for the share sheet.
  const named = new File(Paths.cache, `${t('doc.fileName')}.pdf`);
  if (named.exists) named.delete();
  const pdf = new File(uri);
  await pdf.move(named);
  await Sharing.shareAsync(pdf.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: t('doc.title') });
}
