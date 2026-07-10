import { describe, expect, it } from 'vitest';
import { remarkWikilinks, type MdastNode } from '../src/shared/remark-wikilink';

// Hand-built mdast trees: the plugin only touches node shape, so no unified
// pipeline is needed to exercise it.

function text(value: string): MdastNode {
  return { type: 'text', value };
}

function paragraph(...children: MdastNode[]): MdastNode {
  return { type: 'paragraph', children };
}

function run(tree: MdastNode): MdastNode {
  remarkWikilinks()(tree);
  return tree;
}

describe('remarkWikilinks', () => {
  it('splices a text node into text + link + text', () => {
    const tree = { type: 'root', children: [paragraph(text('see [[note]] here'))] };
    run(tree);
    const para = tree.children![0];
    expect(para.children).toEqual([
      { type: 'text', value: 'see ' },
      { type: 'link', url: 'wikilink:note', children: [{ type: 'text', value: 'note' }] },
      { type: 'text', value: ' here' },
    ]);
  });

  it('uses the alias as the link text', () => {
    const tree = paragraph(text('[[target|Shown]]'));
    run({ type: 'root', children: [tree] });
    expect(tree.children![0]).toMatchObject({
      type: 'link',
      children: [{ type: 'text', value: 'Shown' }],
    });
  });

  it('transforms inside nested containers (blockquote > paragraph, listItem)', () => {
    const tree: MdastNode = {
      type: 'root',
      children: [
        { type: 'blockquote', children: [paragraph(text('[[a]]'))] },
        {
          type: 'list',
          children: [{ type: 'listItem', children: [paragraph(text('[[b]]'))] }],
        },
      ],
    };
    run(tree);
    const quotePara = tree.children![0].children![0];
    const itemPara = tree.children![1].children![0].children![0];
    expect(quotePara.children![0].type).toBe('link');
    expect(itemPara.children![0].type).toBe('link');
  });

  it('handles multiple links in one text node', () => {
    const para = paragraph(text('[[a]] and [[b]]'));
    run({ type: 'root', children: [para] });
    expect(para.children!.map((n) => n.type)).toEqual(['link', 'text', 'link']);
  });

  // Negative controls — code and existing links must come out untouched.
  it('leaves code and inlineCode values untouched', () => {
    const code: MdastNode = { type: 'code', value: 'const x = [[not-a-link]]' };
    const inline: MdastNode = { type: 'inlineCode', value: '[[also-not]]' };
    const tree = { type: 'root', children: [code, paragraph(inline)] };
    run(tree);
    expect(code.value).toBe('const x = [[not-a-link]]');
    expect(inline).toEqual({ type: 'inlineCode', value: '[[also-not]]' });
  });

  it('does not descend into existing link nodes', () => {
    const existing: MdastNode = {
      type: 'link',
      url: 'https://example.com',
      children: [text('literal [[x]] text')],
    };
    run({ type: 'root', children: [paragraph(existing)] });
    expect(existing.children).toEqual([{ type: 'text', value: 'literal [[x]] text' }]);
  });

  it('leaves a wikilink-free tree structurally identical', () => {
    const para = paragraph(text('nothing to do'));
    run({ type: 'root', children: [para] });
    expect(para.children).toEqual([{ type: 'text', value: 'nothing to do' }]);
  });
});
