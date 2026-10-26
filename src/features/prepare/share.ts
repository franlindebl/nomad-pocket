// Exports the plan as an A4 PDF and opens the share sheet (print, save to Files, AirDrop…).
import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { formatCoords } from '@/features/maps/markers';
import i18n, { SUPPORTED_LANGUAGES } from '@/i18n';

import { A4, planDocument } from './document';
import { kitGroups } from './rows';
import { usePrepare } from './store';

const pdfFile = (lang: string) => new File(Paths.cache, `${i18n.getFixedT(lang, 'prepare')('doc.fileName')}.pdf`);

/**
 * The exported PDF holds contacts, medication, allergies and blood types: no copy is kept
 * once it has been shared, nor after the plan is deleted (one file name per language).
 */
export function deletePlanPdfs() {
  for (const lang of SUPPORTED_LANGUAGES) {
    try {
      const f = pdfFile(lang);
      if (f.exists) f.delete();
    } catch (e) {
      console.warn('[prepare] could not delete the exported plan', e);
    }
  }
}

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
  const named = pdfFile(i18n.language);
  if (named.exists) named.delete();
  const pdf = new File(uri);
  await pdf.move(named);
  try {
    await Sharing.shareAsync(pdf.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: t('doc.title') });
  } finally {
    // iOS resolves once the sheet is done with the file. Android may resolve as soon as the
    // target app opens, which reads it later: there the next launch deletes it (initReminders).
    if (Platform.OS === 'ios') deletePlanPdfs();
  }
}
