import React from 'react';
import './shell.css';
const links=[['/','Discover'],['/tools','Profiles'],['/ipa','IPA Inspector'],['/utilities','Developer Utilities']];
export default function Nav(){return <nav className="shell-nav" aria-label="Main navigation"><a className="shell-brand" href="/">◈ RepoViewer</a><div className="shell-links">{links.map(([href,label])=><a key={href} href={href} aria-current={location.pathname===href?'page':undefined}>{label}</a>)}</div></nav>}
