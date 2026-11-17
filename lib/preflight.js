// Rehber üretiminden önce: işin Jira içeriğinde hangi kaynaklara bağlantı var, hangileri kapalı?
// Kapalı bir kaynağa bağlantı varsa kullanıcıya üretimden ÖNCE sorulur; böylece "o kaynak kapalıydı, yeniden oluştur"
// diye dakikalarca süren ve kullanım hakkı harcayan ikinci bir üretim gerekmez.
import { getSettings } from './config.js';

const URL_TAIL = '[^\\s<>|)"\']+';
// qaHere'nin kendi kaynakları (Ayarlar → Kaynaklar)
const SOURCE_LINKS = [
  { key: 'docs', name: 'Claude Docs', re: new RegExp(`https?://claude\\.ai/(?:artifact|code/artifact|public/artifacts|share)/${URL_TAIL}`, 'gi') },
  { key: 'notion', name: 'Notion', re: new RegExp(`https?://${URL_TAIL.slice(0, -1)}*notion\\.(?:so|site)/${URL_TAIL}`, 'gi') },
  { key: 'confluence', name: 'Confluence', re: new RegExp(`https?://[a-z0-9-]+\\.atlassian\\.net/wiki/${URL_TAIL}`, 'gi') },
  { key: 'figma', name: 'Figma', re: new RegExp(`https://(?:www\\.)?figma\\.com/(?:design|file|proto|board)/${URL_TAIL}`, 'gi') },
  { key: 'slack', name: 'Slack', re: new RegExp(`https://[a-z0-9-]+\\.slack\\.com/archives/${URL_TAIL}`, 'gi') },
];
// Kullanıcının diğer Claude bağlantıları (Ayarlar → Diğer Claude bağlantıların)
const CONNECTOR_LINKS = [
  { name: 'claude.ai Google Sheets', re: /https:\/\/docs\.google\.com\/spreadsheets\//gi },
  { name: 'claude.ai Google Docs', re: /https:\/\/docs\.google\.com\/document\//gi },
  { name: 'claude.ai Google Slides', re: /https:\/\/docs\.google\.com\/presentation\//gi },
  { name: 'claude.ai Google Drive', re: /https:\/\/drive\.google\.com\//gi },
  { name: 'claude.ai Miro', re: /https:\/\/miro\.com\/app\/board\//gi },
  { name: 'claude.ai Linear', re: /https:\/\/linear\.app\//gi },
];

const count = (text, re) => new Set(String(text).match(re) || []).size;

/** @returns {{ sources: {key,name,count,enabled}[], connectors: {name,count,enabled}[], missing: number }} */
export function scanSources(text) {
  const s = getSettings();
  const sources = SOURCE_LINKS.map((x) => ({ key: x.key, name: x.name, count: count(text, x.re), enabled: Boolean(s.sources[x.key]) })).filter((x) => x.count);
  const connectors = CONNECTOR_LINKS.map((x) => ({ name: x.name, count: count(text, x.re), enabled: Boolean(s.connectors?.[x.name]?.enabled) })).filter((x) => x.count);
  return { sources, connectors, missing: [...sources, ...connectors].filter((x) => !x.enabled).length };
}
