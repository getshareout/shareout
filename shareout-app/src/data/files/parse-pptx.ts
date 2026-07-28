import { unzipSync } from 'fflate';

export interface SlideSummary {
  index: number;
  title: string;
  lines: string[];
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
}

// pptx is a zip of XML; text lives in <a:t> runs, paragraphs in <a:p>.
// ponytail: text-only extraction; images/layout if slide fidelity ever matters
export function parsePptx(bytes: ArrayBuffer): SlideSummary[] {
  const files = unzipSync(new Uint8Array(bytes), {
    filter: f => /^ppt\/slides\/slide\d+\.xml$/.test(f.name),
  });
  const decoder = new TextDecoder();
  return Object.keys(files)
    .sort((a, b) => Number(a.match(/(\d+)/)![1]) - Number(b.match(/(\d+)/)![1]))
    .map((name, index) => {
      const xml = decoder.decode(files[name]);
      const paragraphs = (xml.match(/<a:p>[\s\S]*?<\/a:p>/g) || [])
        .map(p =>
          (p.match(/<a:t>([\s\S]*?)<\/a:t>/g) || [])
            .map(t => decodeXmlEntities(t.replace(/<\/?a:t>/g, '')))
            .join('')
            .trim()
        )
        .filter(Boolean);
      return { index: index + 1, title: paragraphs[0] || '', lines: paragraphs.slice(1) };
    });
}
