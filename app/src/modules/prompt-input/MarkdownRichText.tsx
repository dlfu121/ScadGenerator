import type { Components } from 'react-markdown';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** 将模型常用的 $R$ 变量记法转为加粗（仅用于方案卡片，避免误伤代码里的 $fn 等） */
function normalizeDollarVars(raw: string): string {
  return raw.replace(/\$([^$\n]+?)\$/g, '**$1**');
}

function createComponents(variant: 'spec' | 'chat'): Partial<Components> {
  const isChat = variant === 'chat';

  return {
    table: (props) => <table className="md-table" {...props} />,
    thead: (props) => <thead className="md-thead" {...props} />,
    tbody: (props) => <tbody {...props} />,
    tr: (props) => <tr {...props} />,
    th: (props) => <th {...props} />,
    td: (props) => <td {...props} />,
    ul: (props) => <ul className="md-ul" {...props} />,
    ol: (props) => <ol className="md-ol" {...props} />,
    li: (props) => <li {...props} />,
    p: (props) => <p className="md-p" {...props} />,
    strong: (props) => <strong className="md-strong" {...props} />,
    code: ({ className, children, ...rest }) => {
      const fence = /language-[\w-]+/.test(className || '');
      if (isChat && fence) {
        return (
          <code className={`md-code-block ${className || ''}`.trim()} {...rest}>
            {children}
          </code>
        );
      }
      return (
        <code className={`md-code-inline ${className || ''}`.trim()} {...rest}>
          {children}
        </code>
      );
    },
    pre: (props) => <pre className={isChat ? 'md-pre-chat' : 'md-pre-spec'} {...props} />,
    h1: (props) => <h3 className="md-h" {...props} />,
    h2: (props) => <h3 className="md-h" {...props} />,
    h3: (props) => <h4 className="md-h3" {...props} />,
    hr: (props) => <hr className="md-hr" {...props} />,
  };
}

interface MarkdownRichTextProps {
  source: string;
  variant: 'spec' | 'chat';
  /** 是否把 $x$ 转成加粗（对话里的代码块不要开，以免误替换） */
  normalizeDollars?: boolean;
}

export function MarkdownRichText({ source, variant, normalizeDollars = false }: MarkdownRichTextProps) {
  const text = normalizeDollars ? normalizeDollarVars(source) : source;
  const rootClass = variant === 'spec' ? 'md-root md-root--spec' : 'md-root md-root--chat';

  return (
    <div className={rootClass}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={createComponents(variant)}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

export function SpecMarkdownBody({ source }: { source: string }) {
  return <MarkdownRichText source={source} variant="spec" normalizeDollars />;
}

export function ChatMarkdownBody({ source }: { source: string }) {
  return <MarkdownRichText source={source} variant="chat" />;
}
