import React from 'react'

/** Inline **bold** and `code` for preview paragraphs. */
export default function RichText({ text }) {
  const parts = String(text || '').split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i}>{part.slice(2, -2)}</strong>
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return (
            <code key={i} style={{ background: '#f3f4f6', padding: '1px 4px', borderRadius: '3px', fontSize: '0.92em' }}>
              {part.slice(1, -1)}
            </code>
          )
        }
        return <span key={i}>{part}</span>
      })}
    </>
  )
}
