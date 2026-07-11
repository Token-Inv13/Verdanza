import { Link } from "react-router-dom";
import type { BlogArticle, BlogArticleBlock } from "../types/blog";

export function BlogArticleRenderer({ article }: { article: BlogArticle }) {
  return (
    <div className="blog-prose">
      {article.blocks.map((block, index) => (
        <BlogBlock key={`${block.type}-${index}`} block={block} />
      ))}
    </div>
  );
}

function BlogBlock({ block }: { block: BlogArticleBlock }) {
  if (block.type === "heading") {
    return <h2 id={block.id}>{block.text}</h2>;
  }

  if (block.type === "paragraph") {
    return <p>{block.text}</p>;
  }

  if (block.type === "list") {
    return (
      <ul>
        {block.items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    );
  }

  if (block.type === "note") {
    return <aside className="blog-note">{block.text}</aside>;
  }

  if (block.type === "links") {
    return (
      <section className="blog-link-panel" aria-labelledby={slugify(block.title)}>
        <h2 id={slugify(block.title)}>{block.title}</h2>
        <div>
          {block.links.map((link) => (
            <Link key={link.to} to={link.to}>
              {link.label}
            </Link>
          ))}
        </div>
      </section>
    );
  }

  return (
    <div className="blog-table-wrap">
      <table>
        <caption>{block.table.caption}</caption>
        <thead>
          <tr>
            {block.table.headers.map((header) => (
              <th key={header} scope="col">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.table.rows.map((row) => (
            <tr key={row.join("|")}>
              {row.map((cell, index) => (
                index === 0 ? (
                  <th key={cell} scope="row">
                    {cell}
                  </th>
                ) : (
                  <td key={cell}>{cell}</td>
                )
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
