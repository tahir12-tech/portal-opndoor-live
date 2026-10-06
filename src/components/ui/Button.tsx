/* =====================================================================
   Button — the .btn family (primary / dark / ghost / quiet, --sm, --block).
   Renders a <button>, a router <Link> (`to`), or an <a> (`href`) so the same
   styling covers the prototype's mix of action buttons and navigation links.
   ===================================================================== */
import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';

export type ButtonVariant = 'primary' | 'dark' | 'ghost' | 'quiet';

interface CommonProps {
  variant?: ButtonVariant;
  size?: 'sm';
  block?: boolean;
  /** Appends the animated → arrow used across the prototype. */
  arrow?: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

type AsButton = CommonProps & { to?: undefined; href?: undefined } & ButtonHTMLAttributes<HTMLButtonElement>;
type AsLink = CommonProps & { to: string } & { onClick?: () => void; title?: string; form?: string };
type AsAnchor = CommonProps & {
  href: string; target?: string; rel?: string; title?: string;
  /** Saves the href rather than navigating to it. The string is the filename. */
  download?: string;
};

export type ButtonProps = AsButton | AsLink | AsAnchor;

function classes(p: CommonProps): string {
  const cls = ['btn'];
  cls.push(`btn--${p.variant ?? 'primary'}`);
  if (p.size === 'sm') cls.push('btn--sm');
  if (p.block) cls.push('btn--block');
  if (p.className) cls.push(p.className);
  return cls.join(' ');
}

export function Button(props: ButtonProps) {
  const { variant, size, block, arrow, className, children } = props as CommonProps;
  const cls = classes({ variant, size, block, arrow, className, children });
  const inner = (
    <>
      {children}
      {arrow && <span className="arrow">&rarr;</span>}
    </>
  );

  const style = (props as CommonProps).style;
  if ('to' in props && props.to != null) {
    const { to, onClick, title, form } = props as AsLink;
    return (
      <Link className={cls} to={to} onClick={onClick} title={title} style={style} {...(form ? { form } : {})}>
        {inner}
      </Link>
    );
  }
  if ('href' in props && props.href != null) {
    const { href, target, rel, title, download } = props as AsAnchor;
    return (
      <a className={cls} href={href} target={target} rel={rel} title={title} download={download} style={style}>
        {inner}
      </a>
    );
  }
  const { variant: _v, size: _s, block: _b, arrow: _a, className: _c, children: _ch, ...btnRest } = props as AsButton;
  return (
    <button className={cls} {...btnRest}>
      {inner}
    </button>
  );
}
