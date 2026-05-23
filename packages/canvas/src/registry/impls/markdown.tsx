import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownProps {
  content?: string;
}

export default function Markdown({ content = '' }: MarkdownProps) {
  return (
    <div className="sf:prose sf:prose-sm sf:max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}
