import { useEffect, useState } from 'react';
import { codeToHtml } from 'shiki';

interface CodeBlockProps {
  code?: string;
  language?: string;
}

// Shiki tokenizes + escapes the input string before returning the HTML, so the
// rendered output is safe from XSS even when `code` originates from user input.
// We render via dangerouslySetInnerHTML because that's shiki's contract.
export default function CodeBlock({ code = '', language = 'text' }: CodeBlockProps) {
  const [html, setHtml] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    codeToHtml(code, { lang: language, theme: 'github-dark' })
      .then((out) => {
        if (!cancelled) setHtml(out);
      })
      .catch(() => {
        if (!cancelled) setHtml('');
      });
    return () => {
      cancelled = true;
    };
  }, [code, language]);

  if (!html) {
    return (
      <pre className="sf:overflow-x-auto sf:rounded-md sf:bg-muted sf:p-3 sf:text-xs">
        <code>{code}</code>
      </pre>
    );
  }
  return (
    <div
      className="sf:overflow-x-auto sf:rounded-md sf:text-xs sf:[&_pre]:p-3"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: shiki escapes input before tokenizing
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
