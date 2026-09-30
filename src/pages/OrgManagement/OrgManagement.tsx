// /* =====================================================================
//    Agencies & branches — the partner organisation hierarchy. Expandable
//    agencies, live search with highlighting, drill-through figures to the
//    applications behind them, the add-agency/add-branch modals, the
//    Management-only commission columns (per-partner rates), and the opndoor
//    admin partner selector. View for all roles; canonical editing is admin.

//    Every mutation here PERSISTS through a gated RPC (Supabase mode) and then
//    re-hydrates from the server, so nothing an admin saves can vanish on the
//    next hydration. Admin-created records land confirmed; management-created
//    land pending_review. In mock/test mode the same edits apply locally.
//    ===================================================================== */
// import { useState, type MouseEvent, type ReactNode } from 'react';
// import { Link } from 'react-router-dom';
// import {
//   ALL_PARTNERS, addContactLive, createAgencyLive, createBranchLive, effectivePrimary, findAgency,
//   getAgencies, getPartners, getRatesFor, removeContactLive, setPrimaryLive, updateContactLive,
//   type Agency, type AgentContact, type Branch,
// } from '@/data';
import { showsOffices } from '@/data/agencyOffices';
// import { useSession } from '@/session/SessionContext';
// import { usePageMeta } from '@/components/layout/pageMeta';
// import { useToast } from '@/components/ui/Toast';
// import { Button } from '@/components/ui/Button';
// import { Icon } from '@/components/ui/Icon';
// import { Eyebrow } from '@/components/ui/Eyebrow';
// import { Field } from '@/components/ui/Field';
// import { Modal } from '@/components/ui/Modal';
// import { PartnerSelect } from '@/components/ui/Select';
// import './OrgManagement.css';

// const agencyId = (a: Agency) => `${a.partner || 'northwind'}:${a.name}`;
// const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// /** An inline, consequence-aware confirmation rendered inside the contacts modal. */
// interface CtConfirm {
//   title: string;
//   body: ReactNode;
//   confirmLabel: string;
//   danger?: boolean;
//   success?: string;
//   /** A refusal, not a choice: one dismiss button, no destructive action (#72). */
//   blocking?: boolean;
//   /** Whether to re-hydrate after the action (mutations yes, a pure discard no). */
//   refreshAfter: boolean;
//   run: () => Promise<void>;
// }

// function highlight(name: string, q: string): ReactNode {
//   if (!q) return name;
//   const i = name.toLowerCase().indexOf(q);
//   if (i === -1) return name;
//   return (
//     <>
//       {name.slice(0, i)}
//       <mark className="hl">{name.slice(i, i + q.length)}</mark>
//       {name.slice(i + q.length)}
//     </>
//   );
// }

// function feesOf(item: Agency | Branch, isAgency: boolean): number {
//   if (item.fees != null) return item.fees;
//   if (isAgency && (item as Agency).branches) return (item as Agency).branches.reduce((s, b) => s + feesOf(b, false), 0);
//   return Math.round((item.referrals || 0) * 0.78 * 2180);
// }
// function fmtK(n: number): string {
//   if (n >= 1e6) return `£${(n / 1e6).toFixed(2)}M`;
//   if (n >= 1e3) return `£${Math.round(n / 1e3)}k`;
//   return `£${Math.round(n)}`;
// }

// const goIcon = <span className="statlink__go"><Icon name="arrowRight" strokeWidth={2.2} /></span>;
// const ctInitials = (n: string) => n.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
// /** A contact often has no real name (email is the load-bearing field), and older
//     records stored the email in the name column. Treat a blank or email-shaped
//     name as "no name" so we never render an email address as a person's name (#69). */
// const realName = (name: string, email: string): string => {
//   const n = (name || '').trim();
//   if (!n || n.includes('@') || n.toLowerCase() === (email || '').trim().toLowerCase()) return '';
//   return n;
// };

// /** The effective-primary-contact summary line shown under an agency or branch name. */
// function ContactSummary({ agency, branch, canManage, onManage }: { agency: Agency; branch: Branch | null; canManage: boolean; onManage: () => void }) {
//   const ep = effectivePrimary(agency, branch);
//   const manageBtn = canManage ? (
//     <button className="contact-manage" onClick={(e) => { e.stopPropagation(); onManage(); }}>Manage</button>
//   ) : null;
//   if (!ep.contact) {
//     return <div className="contact-line"><Icon name="mail" /><span className="cl-none">No agent contact</span>{manageBtn}</div>;
//   }
//   return (
//     <div className="contact-line">
//       <Icon name="mail" />
//       <span>{realName(ep.contact.name, ep.contact.email) ? <><b>{realName(ep.contact.name, ep.contact.email)}</b> · {ep.contact.email}</> : <b>{ep.contact.email}</b>}</span>
//       {branch && ep.inherited && <span className="cl-inherit">(agency default)</span>}
//       {manageBtn}
//     </div>
//   );
// }

// export function OrgManagement() {
//   usePageMeta('org', 'Agencies & branches', ['Home', 'Administration', 'Agencies & branches']);
//   const { role, partnerScope, selectedPartner, setSelectedPartner, refresh: refreshData } = useSession();
//   const toast = useToast();

//   const [, setVersion] = useState(0);
//   const refresh = () => setVersion((v) => v + 1);
//   const [busy, setBusy] = useState(false);
//   const [query, setQuery] = useState('');
//   const [openSet, setOpenSet] = useState<Set<string>>(() => new Set(getAgencies(ALL_PARTNERS).filter((a) => a.open).map(agencyId)));

//   // add-agency modal (+ its required default contact)
//   const [agencyOpen, setAgencyOpen] = useState(false);
//   const [agencyName, setAgencyName] = useState('');
//   const [agencyGroup, setAgencyGroup] = useState('');
//   const [agencyContact, setAgencyContact] = useState({ name: '', email: '', phone: '' });
//   // add-branch modal (+ its optional own contact)
//   const [branchOpen, setBranchOpen] = useState(false);
//   const [branchName, setBranchName] = useState('');
//   const [branchArea, setBranchArea] = useState('');
//   const [branchAgency, setBranchAgency] = useState('');
//   const [branchContact, setBranchContact] = useState({ name: '', email: '', phone: '' });

//   // contacts modal (agent contacts on an agency or branch). Editable by Management too.
//   const canManageOrg = role === 'superadmin' || role === 'management';
//   const canManageContacts = role === 'superadmin' || role === 'management';
//   const [ctOpen, setCtOpen] = useState(false);
//   const [ctAgencyName, setCtAgencyName] = useState('');
//   const [ctBranchName, setCtBranchName] = useState<string | null>(null);
//   const [ctEditIndex, setCtEditIndex] = useState<number | null>(null);
//   const [ctName, setCtName] = useState('');
//   const [ctRole, setCtRole] = useState('');
//   const [ctEmail, setCtEmail] = useState('');
//   const [ctPhone, setCtPhone] = useState('');
//   const [ctPrimary, setCtPrimary] = useState(false);
//   const [ctConfirm, setCtConfirm] = useState<CtConfirm | null>(null);

//   const rates = getRatesFor(partnerScope);
//   const isMgmt = role === 'management';
//   const q = query.trim().toLowerCase();
//   const pool = getAgencies(partnerScope);

//   const partnerPoolForBranch = getAgencies(partnerScope);

//   // Resolve the contacts-modal owner fresh each render (reflects mutations + re-hydration).
//   const ctAgency = ctOpen ? findAgency(ctAgencyName) ?? null : null;
//   const ctBranch = ctBranchName && ctAgency ? ctAgency.branches.find((b) => b.name === ctBranchName) ?? null : null;
//   const ctContacts: AgentContact[] = (ctBranchName ? ctBranch?.contacts : ctAgency?.contacts) ?? [];
//   const ownerLabel = ctBranchName ? ctBranchName : ctAgencyName;

//   // Is the contact form holding unsaved input? (drives the item-58 close guard).
//   const ctEditing = ctEditIndex !== null ? ctContacts[ctEditIndex] : null;
//   const formHasContent = !!(ctName.trim() || ctEmail.trim() || ctRole.trim() || ctPhone.trim());
//   const formDirty = ctEditIndex === null
//     ? (formHasContent || ctPrimary)
//     : (!!ctEditing && (
//         ctName !== ctEditing.name || ctEmail !== ctEditing.email ||
//         (ctRole || '') !== (ctEditing.role || '') || (ctPhone || '') !== (ctEditing.phone || '') ||
//         ctPrimary !== !!ctEditing.primary));

//   function openContacts(agencyName: string, branchName: string | null) {
//     setCtAgencyName(agencyName);
//     setCtBranchName(branchName);
//     setCtConfirm(null);
//     resetContactForm();
//     setCtOpen(true);
//   }
//   function resetContactForm() {
//     setCtEditIndex(null);
//     setCtName('');
//     setCtRole('');
//     setCtEmail('');
//     setCtPhone('');
//     setCtPrimary(false);
//   }
//   function startEditContact(index: number) {
//     const c = ctContacts[index];
//     if (!c) return;
//     setCtConfirm(null);
//     setCtEditIndex(index);
//     setCtName(c.name);
//     setCtRole(c.role || '');
//     setCtEmail(c.email);
//     setCtPhone(c.phone || '');
//     setCtPrimary(!!c.primary);
//   }

//   /** Run a persisting mutation: apply, re-hydrate from the server, toast. */
//   async function runOrg(fn: () => Promise<void>, success: string, after?: () => void): Promise<void> {
//     if (busy) return;
//     setBusy(true);
//     try {
//       await fn();
//       await refreshData();
//       refresh();
//       after?.();
//       toast(success);
//     } catch (e) {
//       toast(e instanceof Error ? e.message : 'Something went wrong.', 'error');
//     } finally {
//       setBusy(false);
//     }
//   }

//   /** Run the inline confirm's action (mutations re-hydrate; a discard does not). */
//   async function runCtConfirm(): Promise<void> {
//     if (!ctConfirm || busy) return;
//     const spec = ctConfirm;
//     setBusy(true);
//     try {
//       await spec.run();
//       if (spec.refreshAfter) { await refreshData(); refresh(); }
//       if (spec.success) toast(spec.success);
//       setCtConfirm(null);
//     } catch (e) {
//       toast(e instanceof Error ? e.message : 'Something went wrong.', 'error');
//     } finally {
//       setBusy(false);
//     }
//   }

//   function submitContact() {
//     if (!ctAgency || busy) return;
//     const name = ctName.trim();
//     const email = ctEmail.trim();
//     // Email is the load-bearing field (#72); the name is optional.
//     if (!email) { toast('Enter a contact email.'); return; }
//     if (!EMAIL_RE.test(email)) { toast('Enter a valid contact email.'); return; }
//     const rec: AgentContact = { name, role: ctRole.trim(), email, phone: ctPhone.trim(), primary: ctPrimary };
//     if (ctEditIndex !== null) {
//       const idx = ctEditIndex;
//       const orig = ctContacts[idx];
//       const otherPrimary = ctContacts.some((c, i) => i !== idx && c.primary);
//       // Item 56: preserve primary through edits; warn before leaving no primary.
//       if (orig?.primary && !ctPrimary && !otherPrimary) {
//         setCtConfirm({
//           title: 'Leave no primary contact?',
//           body: <><b>{ownerLabel}</b> must keep a primary contact for deed delivery. If you save without one, a remaining contact is promoted automatically. To move it deliberately, set another contact as primary instead.</>,
//           confirmLabel: 'Save anyway', danger: true, success: 'Contact updated.', refreshAfter: true,
//           run: async () => { await updateContactLive(ctAgency, ctBranch, idx, orig?.id, rec); resetContactForm(); },
//         });
//         return;
//       }
//       void runOrg(() => updateContactLive(ctAgency, ctBranch, idx, orig?.id, rec), 'Contact updated.', resetContactForm);
//     } else {
//       void runOrg(() => addContactLive(ctAgency, ctBranch, rec), 'Contact added.', resetContactForm);
//     }
//   }

//   /** The consequence text for removing the contact at index (item 57). */
//   function removeConsequence(index: number): ReactNode {
//     const c = ctContacts[index];
//     const isOnly = ctContacts.length === 1;
//     const others = ctContacts.filter((_, i) => i !== index);
//     if (!ctBranchName) {
//       if (isOnly) {
//         const inheriting = (ctAgency?.branches ?? []).filter((b) => !(b.contacts && b.contacts.length)).length;
//         return <>This is <b>{ctAgencyName}</b>'s only contact. {inheriting} {inheriting === 1 ? 'branch inherits' : 'branches inherit'} it, so {inheriting === 1 ? 'its' : 'their'} deeds will have no delivery address until you add another. This cannot be undone.</>;
//       }
//       if (c.primary) return <><b>{c.name}</b> is <b>{ctAgencyName}</b>'s primary contact. Removing them promotes <b>{others[0].name}</b> to primary. This cannot be undone.</>;
//       return <>Remove <b>{c.name}</b> from <b>{ctAgencyName}</b>? This cannot be undone.</>;
//     }
//     if (isOnly) {
//       const agDefault = effectivePrimary(ctAgency, null).contact;
//       return agDefault
//         ? <>This is <b>{ctBranchName}</b>'s only contact. The branch will fall back to the <b>{ctAgencyName}</b> agency default (<b>{agDefault.name}</b>). This cannot be undone.</>
//         : <>This is <b>{ctBranchName}</b>'s only contact, and <b>{ctAgencyName}</b> has no contact either, so deeds for this branch will have no delivery address. This cannot be undone.</>;
//     }
//     if (c.primary) return <><b>{c.name}</b> is this branch's primary contact. Removing them promotes <b>{others[0].name}</b> to primary. This cannot be undone.</>;
//     return <>Remove <b>{c.name}</b> from <b>{ctBranchName}</b>? This cannot be undone.</>;
//   }

//   function askRemoveContact(index: number) {
//     if (!ctAgency) return;
//     const c = ctContacts[index];
//     if (!c) return;
//     // #72: an agency's LAST contact cannot be removed - deeds must always have a
//     // delivery address. Refuse (do not warn-and-proceed); add a replacement first.
//     if (!ctBranchName && ctContacts.length === 1) {
//       const inheriting = (ctAgency.branches ?? []).filter((b) => !(b.contacts && b.contacts.length)).length;
//       setCtConfirm({
//         title: 'Add a replacement contact first',
//         body: <><b>{ctAgencyName}</b> must keep at least one contact so its deeds always have a delivery address{inheriting ? <> ({inheriting} {inheriting === 1 ? 'branch inherits' : 'branches inherit'} it)</> : null}. Add a replacement contact below, then remove this one.</>,
//         confirmLabel: 'Got it', blocking: true, refreshAfter: false,
//         run: async () => {},
//       });
//       return;
//     }
//     setCtConfirm({
//       title: `Remove ${c.name}?`,
//       body: removeConsequence(index),
//       confirmLabel: 'Remove contact', danger: true, success: 'Contact removed.', refreshAfter: true,
//       run: async () => { await removeContactLive(ctAgency, ctBranch, index, c.id); resetContactForm(); },
//     });
//   }

//   function makePrimary(index: number) {
//     if (!ctAgency) return;
//     const c = ctContacts[index];
//     void runOrg(() => setPrimaryLive(ctAgency, ctBranch, index, c?.id), 'Primary contact updated.');
//   }

//   // Item 58: pressing Done (or closing) must not silently discard a part-filled form.
//   function requestCloseContacts() {
//     if (busy) return;
//     if (ctConfirm) return; // resolve the open confirmation first
//     if (formDirty) {
//       setCtConfirm({
//         title: 'Discard unsaved contact?',
//         body: <>You have entered contact details that have not been saved. Closing now will discard them.</>,
//         confirmLabel: 'Discard', danger: true, refreshAfter: false,
//         run: async () => { resetContactForm(); setCtOpen(false); },
//       });
//       return;
//     }
//     setCtOpen(false);
//   }

//   function toggle(id: string) {
//     setOpenSet((prev) => {
//       const next = new Set(prev);
//       if (next.has(id)) next.delete(id);
//       else next.add(id);
//       return next;
//     });
//   }

//   function onHeadClick(e: MouseEvent, id: string) {
//     const target = e.target as HTMLElement;
//     if (target.closest('.statlink') || target.closest('[data-stop]')) return;
//     toggle(id);
//   }

//   const agencyEmailOk = EMAIL_RE.test(agencyContact.email.trim());
//   const canSaveAgency = !!agencyName.trim() && agencyEmailOk && !busy;
//   function saveAgency() {
//     if (!canSaveAgency) return;
//     void runOrg(
//       () => createAgencyLive({
//         name: agencyName.trim(), group: agencyGroup.trim() || undefined,
//         contactEmail: agencyContact.email.trim(), contactName: agencyContact.name.trim() || undefined, contactPhone: agencyContact.phone.trim() || undefined,
//       }, partnerScope),
//       'Agency added.',
//       () => setAgencyOpen(false),
//     );
//   }

//   function openAddBranch(name?: string) {
//     setBranchName('');
//     setBranchArea('');
//     setBranchContact({ name: '', email: '', phone: '' });
//     setBranchAgency(name || partnerPoolForBranch[0]?.name || '');
//     setBranchOpen(true);
//   }
//   const branchEmailProvided = !!branchContact.email.trim();
//   const branchEmailOk = EMAIL_RE.test(branchContact.email.trim());
//   const canSaveBranch = !!branchName.trim() && !!branchAgency && (!branchEmailProvided || branchEmailOk) && !busy;
//   function saveBranch() {
//     if (!canSaveBranch) return;
//     const agency = findAgency(branchAgency);
//     if (!agency) { toast('Select a parent agency.'); return; }
//     void runOrg(
//       () => createBranchLive(agency, {
//         name: branchName.trim(), area: branchArea.trim() || undefined,
//         contactEmail: branchContact.email.trim() || undefined, contactName: branchContact.name.trim() || undefined, contactPhone: branchContact.phone.trim() || undefined,
//       }),
//       'Branch added.',
//       () => setBranchOpen(false),
//     );
//   }

//   const eyebrow = role === 'superadmin' ? 'opndoor admin' : role === 'management' ? 'Management' : 'Organisation';
//   const roleNote: ReactNode =
//     role === 'superadmin' ? <>As an <b>opndoor admin</b> you have full control: add, edit and reorganise agencies and branches, and sync the hierarchy with HubSpot.</>
//       : role === 'management' ? <>You can view, add and edit your partner's agencies and branches, and your changes apply straight away. HubSpot sync is handled by <b>opndoor</b>.</>
//         : <>You can view every agency and branch. Adding and editing records is handled by your management team and <b>opndoor</b>.</>;

//   // Filtered, with expand-all while searching (mirrors org-management.html).
//   const shownAgencies = pool
//     .map((a) => {
//       const agencyMatch = a.name.toLowerCase().includes(q);
//       const branches = a.branches.filter((b) => !q || agencyMatch || b.name.toLowerCase().includes(q));
//       return { a, agencyMatch, branches };
//     })
//     .filter(({ agencyMatch, branches }) => !(q && !agencyMatch && branches.length === 0));

//   return (
//     <>
//       <div className="page-head">
//         <div>
//           <Eyebrow>{eyebrow}</Eyebrow>
//           <h1 className="page-head__title" style={{ marginTop: 10 }}>Agencies &amp; branches</h1>
//           <p className="page-head__sub">Manage the partner organisation hierarchy. Search to find an agency or branch, expand to see branches, or click any figure to view the applications behind it.</p>
//         </div>
//         <div className="page-head__actions">
//           {role === 'superadmin' && (
//             <PartnerSelect
//               ariaLabel="Partner"
//               value={selectedPartner}
//               onChange={setSelectedPartner}
//               options={[{ value: ALL_PARTNERS, label: 'All partners' }, ...getPartners().map((p) => ({ value: p.id, label: p.name }))]}
//             />
//           )}
//           <Button variant="ghost" size="sm"><Icon name="download" /> Export</Button>
//           {canManageOrg && (
//             <Button variant="primary" size="sm" onClick={() => { setAgencyName(''); setAgencyGroup(''); setAgencyContact({ name: '', email: '', phone: '' }); setAgencyOpen(true); }}><Icon name="plus" /> Add agency</Button>
//           )}
//         </div>
//       </div>

//       <div className="rolenote" style={{ marginBottom: 18 }}>
//         <Icon name="shield" />
//         <span>{roleNote}</span>
//       </div>

//       <div className={`org-search${query.trim() ? ' has-q' : ''}`}>
//         <Icon name="search" />
//         <input type="text" placeholder="Search agencies or branches" autoComplete="off" value={query} onChange={(e) => setQuery(e.target.value)} />
//         <button className="org-search__clear" aria-label="Clear search" onClick={() => setQuery('')}><Icon name="x" size={16} /></button>
//       </div>

//       <div className="org">
//         {shownAgencies.map(({ a, branches }) => {
//           const id = agencyId(a);
//           const open = q ? true : openSet.has(id);
//           const fees = feesOf(a, true);
//           const meta = `${a.group ? `${a.group} · ` : ''}${a.branches.length} ${a.branches.length === 1 ? 'branch' : 'branches'}`;
//           return (
//             <div className={`agency${open ? ' is-open' : ''}`} key={id}>
//               <div className="agency__head" onClick={(e) => onHeadClick(e, id)}>
//                 <span className="agency__chev"><Icon name="chevronRight" size={18} strokeWidth={2.2} /></span>
//                 <span className="agency__ic"><Icon name="org" /></span>
//                 <div className="agency__txt">
//                   <div className="agency__name">{highlight(a.name, q)}</div>
//                   <div className="agency__meta">{meta}</div>
//                   <ContactSummary agency={a} branch={null} canManage={canManageContacts} onManage={() => openContacts(a.name, null)} />
//                 </div>
//                 <Link className="statlink statlink--agency" to={`/applications?agency=${encodeURIComponent(a.name)}`} title={`View all applications for ${a.name}`}>
//                   <div className="agency__stat"><div className="n">{a.referrals}</div><div className="l">Referrals</div></div>
//                   <div className="agency__stat"><div className="n">{fmtK(fees)}</div><div className="l">Fees collected</div></div>
//                   {isMgmt && <div className="agency__stat"><div className="n">{fmtK(fees * rates.partner)}</div><div className="l">Your commission</div></div>}
//                   {isMgmt && <div className="agency__stat"><div className="n">{fmtK(fees * rates.agent)}</div><div className="l">Agent comm.</div></div>}
//                   {goIcon}
//                 </Link>
//                 {role === 'superadmin' && (
//                   <div className="agency__actions" data-stop>
//                     <button className="iconbtn iconbtn--sm" title="Edit"><Icon name="edit" /></button>
//                   </div>
//                 )}
//               </div>
//               <div className="branches">
//                 {branches.map((b) => {
//                   const bFees = feesOf(b, false);
//                   return (
//                     <div className="branch" key={b.name}>
//                       <span className="branch__line">│</span>
//                       <span className="branch__ic"><Icon name="home" /></span>
//                       <div className="branch__txt">
//                         <div className="branch__name">{highlight(b.name, q)}</div>
//                         <div className="branch__meta">{b.area}</div>
//                         <ContactSummary agency={a} branch={b} canManage={canManageContacts} onManage={() => openContacts(a.name, b.name)} />
//                       </div>
//                       <Link className="statlink statlink--branch" to={`/applications?branch=${encodeURIComponent(b.name)}`} title={`View applications for ${b.name}`}>
//                         <div className="branch__stat"><b>{b.referrals}</b>referrals</div>
//                         <div className="branch__stat"><b>{fmtK(bFees)}</b>fees collected</div>
//                         {isMgmt && <div className="branch__stat"><b>{fmtK(bFees * rates.partner)}</b>your comm.</div>}
//                         {isMgmt && <div className="branch__stat"><b>{fmtK(bFees * rates.agent)}</b>agent comm.</div>}
//                         {goIcon}
//                       </Link>
//                     </div>
//                   );
//                 })}
//                 {!q && canManageOrg && (
//                   <div className="branch__add">
//                     <Button variant="ghost" size="sm" onClick={() => openAddBranch(a.name)}><Icon name="plus" /> Add branch</Button>
//                   </div>
//                 )}
//               </div>
//             </div>
//           );
//         })}
//       </div>
//       <div className={`org-empty${shownAgencies.length ? '' : ' is-shown'}`}>No agencies or branches match your search.</div>

//       {/* ADD AGENCY */}
//       <Modal
//         open={agencyOpen}
//         onClose={() => { if (!busy) setAgencyOpen(false); }}
//         title="Add agency"
//         sub="Create a new agency in the hierarchy. A default contact is required so deeds and the bordereau resolve to someone reachable."
//         footer={<><Button variant="ghost" onClick={() => setAgencyOpen(false)} disabled={busy}>Cancel</Button><Button variant="primary" onClick={saveAgency} disabled={!canSaveAgency}>{busy ? 'Saving…' : 'Save agency'}</Button></>}
//       >
//         <Field label="Agency name" htmlFor="agency-name"><input id="agency-name" type="text" placeholder="e.g. Riverside Lettings" autoComplete="off" value={agencyName} onChange={(e) => setAgencyName(e.target.value)} /></Field>
//         <Field label="Group / network" htmlFor="agency-group" hint="Optional"><input id="agency-group" type="text" placeholder="e.g. ABC group" autoComplete="off" value={agencyGroup} onChange={(e) => setAgencyGroup(e.target.value)} /></Field>
//         <div style={{ borderTop: '1px solid var(--line)', paddingTop: 14, marginTop: 6 }}>
//           <div style={{ fontFamily: 'var(--display)', fontWeight: 700, fontSize: 13.5, marginBottom: 4 }}>Default agency contact</div>
//           <p style={{ fontSize: 12.5, color: 'var(--ink-mute)', margin: '0 0 12px' }}>Its branches inherit this contact unless they have their own.</p>
//           <div className="form-grid">
//             <Field span2 label={<>Contact email <span className="req" aria-hidden="true">*</span></>} htmlFor="agency-cemail"><input id="agency-cemail" type="email" placeholder="agent@agency.co.uk" autoComplete="off" value={agencyContact.email} onChange={(e) => setAgencyContact((c) => ({ ...c, email: e.target.value }))} /></Field>
//             <Field label="Contact name" htmlFor="agency-cname" hint="Optional"><input id="agency-cname" type="text" placeholder="e.g. Jordan Blake" autoComplete="off" value={agencyContact.name} onChange={(e) => setAgencyContact((c) => ({ ...c, name: e.target.value }))} /></Field>
//             <Field label="Contact phone" htmlFor="agency-cphone" hint="Optional"><input id="agency-cphone" type="tel" placeholder="020 7946 0000" autoComplete="off" value={agencyContact.phone} onChange={(e) => setAgencyContact((c) => ({ ...c, phone: e.target.value }))} /></Field>
//           </div>
//         </div>
//       </Modal>

//       {/* ADD BRANCH */}
//       <Modal
//         open={branchOpen}
//         onClose={() => { if (!busy) setBranchOpen(false); }}
//         title="Add branch"
//         sub="Add a branch to an agency. A branch with no contact of its own inherits the agency default."
//         footer={<><Button variant="ghost" onClick={() => setBranchOpen(false)} disabled={busy}>Cancel</Button><Button variant="primary" onClick={saveBranch} disabled={!canSaveBranch}>{busy ? 'Saving…' : 'Save branch'}</Button></>}
//       >
//         <Field label="Branch name" htmlFor="branch-name"><input id="branch-name" type="text" placeholder="e.g. Notting Hill" autoComplete="off" value={branchName} onChange={(e) => setBranchName(e.target.value)} /></Field>
//         <Field label="Postcode / area" htmlFor="branch-area" hint="Optional"><input id="branch-area" type="text" placeholder="e.g. W11" autoComplete="off" value={branchArea} onChange={(e) => setBranchArea(e.target.value)} /></Field>
//         <Field label="Parent agency" htmlFor="branch-agency">
//           <select id="branch-agency" value={branchAgency} onChange={(e) => setBranchAgency(e.target.value)}>
//             {partnerPoolForBranch.map((a) => <option key={agencyId(a)} value={a.name}>{a.name}</option>)}
//           </select>
//         </Field>
//         <div style={{ borderTop: '1px solid var(--line)', paddingTop: 14, marginTop: 6 }}>
//           <div style={{ fontFamily: 'var(--display)', fontWeight: 700, fontSize: 13.5, marginBottom: 4 }}>Branch contact <span style={{ fontWeight: 400, color: 'var(--ink-mute)' }}>(optional)</span></div>
//           <p style={{ fontSize: 12.5, color: 'var(--ink-mute)', margin: '0 0 12px' }}>Leave blank to inherit the agency default contact.</p>
//           <div className="form-grid">
//             <Field span2 label="Contact email" htmlFor="branch-cemail" hint="Optional"><input id="branch-cemail" type="email" placeholder="branch@agency.co.uk" autoComplete="off" value={branchContact.email} onChange={(e) => setBranchContact((c) => ({ ...c, email: e.target.value }))} /></Field>
//             <Field label="Contact name" htmlFor="branch-cname" hint="Optional"><input id="branch-cname" type="text" placeholder="e.g. Sam Rivers" autoComplete="off" value={branchContact.name} onChange={(e) => setBranchContact((c) => ({ ...c, name: e.target.value }))} /></Field>
//             <Field label="Contact phone" htmlFor="branch-cphone" hint="Optional"><input id="branch-cphone" type="tel" placeholder="020 7946 0000" autoComplete="off" value={branchContact.phone} onChange={(e) => setBranchContact((c) => ({ ...c, phone: e.target.value }))} /></Field>
//           </div>
//         </div>
//       </Modal>

//       {/* MANAGE AGENT CONTACTS */}
//       <Modal
//         open={ctOpen}
//         onClose={requestCloseContacts}
//         title={`${ctBranchName || ctAgencyName} contacts`}
//         sub={ctBranchName ? 'Agent contacts for this branch. Who the Deed of Guarantee is sent to.' : 'Agency contacts. Used as the default for branches with no contact of their own.'}
//         footer={<Button variant="primary" onClick={requestCloseContacts} disabled={busy}>Done</Button>}
//       >
//         {ctConfirm && (
//           <div className={`ct-confirm${ctConfirm.danger ? ' is-danger' : ''}`}>
//             <div className="ct-confirm__title">{ctConfirm.title}</div>
//             <div className="ct-confirm__body">{ctConfirm.body}</div>
//             <div className="ct-confirm__actions">
//               {ctConfirm.blocking ? (
//                 <Button variant="primary" size="sm" onClick={() => setCtConfirm(null)} disabled={busy}>{ctConfirm.confirmLabel}</Button>
//               ) : (
//                 <>
//                   <Button variant="ghost" size="sm" onClick={() => setCtConfirm(null)} disabled={busy}>Cancel</Button>
//                   <Button variant="primary" size="sm" className={ctConfirm.danger ? 'btn--danger' : undefined} onClick={runCtConfirm} disabled={busy}>{busy ? 'Working…' : ctConfirm.confirmLabel}</Button>
//                 </>
//               )}
//             </div>
//           </div>
//         )}

//         {ctBranchName && ctContacts.length === 0 && (
//           <div className="ct-inherit-note">
//             {effectivePrimary(ctAgency, ctBranch).contact ? (
//               <>This branch has no contact of its own, so it uses the <b>{ctAgencyName}</b> agency default (<b>{effectivePrimary(ctAgency, ctBranch).contact!.name}</b>). Add a contact below to override it for this branch.</>
//             ) : (
//               <>This branch has no contact of its own, and the agency has none either. Add a branch contact below, or add an agency contact to cover all its branches.</>
//             )}
//           </div>
//         )}

//         <div>
//           {ctContacts.length === 0 ? (
//             <p style={{ fontSize: 13, color: 'var(--ink-mute)', padding: '6px 0 14px' }}>No contacts yet.</p>
//           ) : (
//             ctContacts.map((c, i) => (
//               <div className="ct-row" key={c.id ?? i}>
//                 <span className="ct-av">{ctInitials(c.name)}</span>
//                 <div className="ct-main">
//                   <div className="ct-name">{realName(c.name, c.email) || c.email}{c.primary && <span className="ct-primary">Primary</span>}</div>
//                   <div className="ct-sub">{[c.role, realName(c.name, c.email) ? c.email : null, c.phone].filter(Boolean).join(' · ')}</div>
//                 </div>
//                 <div className="ct-actions">
//                   {!c.primary && <button onClick={() => makePrimary(i)} disabled={busy}>Set primary</button>}
//                   <button onClick={() => startEditContact(i)} disabled={busy}>Edit</button>
//                   <button onClick={() => askRemoveContact(i)} disabled={busy}>Remove</button>
//                 </div>
//               </div>
//             ))
//           )}
//         </div>

//         <div style={{ borderTop: '1px solid var(--line)', paddingTop: 16, marginTop: 6 }}>
//           <div style={{ fontFamily: 'var(--display)', fontWeight: 700, fontSize: 13.5, marginBottom: 4 }}>{ctEditIndex !== null ? 'Edit contact' : 'Add a contact'}</div>
//           <p style={{ fontSize: 12.5, color: 'var(--ink-mute)', margin: '0 0 12px' }}>The email is what matters. It is where the Deed of Guarantee is delivered.</p>
//           <div className="form-grid">
//             <Field span2 label={<>Contact email <span className="req" aria-hidden="true">*</span></>} htmlFor="ct-email"><input id="ct-email" type="email" placeholder="deeds@agency.co.uk" autoComplete="off" value={ctEmail} onChange={(e) => setCtEmail(e.target.value)} /></Field>
//             <div className="field span-2" style={{ marginTop: -6 }}><span className="hint">Use a shared work address (e.g. deeds@agency.co.uk) rather than a personal one. Deeds must always deliver, even when staff change.</span></div>
//             <Field label="Name" htmlFor="ct-name" hint="Optional"><input id="ct-name" type="text" placeholder="e.g. Deeds team" autoComplete="off" value={ctName} onChange={(e) => setCtName(e.target.value)} /></Field>
//             <Field label="Role" htmlFor="ct-role" hint="Optional"><input id="ct-role" type="text" placeholder="e.g. Branch manager" autoComplete="off" value={ctRole} onChange={(e) => setCtRole(e.target.value)} /></Field>
//             <Field className="span-2" label="Phone" htmlFor="ct-phone" hint="Optional"><input id="ct-phone" type="text" autoComplete="off" value={ctPhone} onChange={(e) => setCtPhone(e.target.value)} /></Field>
//             <label className="field span-2" style={{ flexDirection: 'row', alignItems: 'center', gap: 9, display: 'flex' }}>
//               <input type="checkbox" checked={ctPrimary} onChange={(e) => setCtPrimary(e.target.checked)} style={{ width: 'auto' }} />
//               <span style={{ fontSize: 13, color: 'var(--ink-soft)', fontWeight: 600, textTransform: 'none', letterSpacing: 0 }}>Primary contact (receives the deed by default)</span>
//             </label>
//           </div>
//           <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
//             <Button variant="primary" size="sm" onClick={submitContact} disabled={busy}>{ctEditIndex !== null ? 'Save contact' : 'Add contact'}</Button>
//             {ctEditIndex !== null && <Button variant="ghost" size="sm" onClick={resetContactForm} disabled={busy}>Cancel edit</Button>}
//           </div>
//         </div>
//       </Modal>word_wrap
//     </>
//   );
// }


/* =====================================================================
   Agencies & branches — the partner organisation hierarchy. Expandable
   agencies, live search with highlighting, drill-through figures to the
   applications behind them, the add-agency/add-branch modals, the
   Management-only commission columns (per-partner rates), and the opndoor
   admin partner selector. View for all roles; canonical editing is admin.

   Every mutation here PERSISTS through a gated RPC (Supabase mode) and then
   re-hydrates from the server, so nothing an admin saves can vanish on the
   next hydration. Admin-created records land confirmed; management-created
   land pending_review. In mock/test mode the same edits apply locally.
   ===================================================================== */
import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { getOrgDeedReadiness, type DeedReadiness } from '@/data/positionsService';
import {
  ALL_PARTNERS, addContactLive, createBranchLive, effectivePrimary, findAgency,
  getAgencies, getGroups, getPartner, getRatesFor, createAgencyGroup, maySeeCommission, setAgencyGroup as attachAgencyToGroup, removeContactLive, setPrimaryLive, updateContactLive,
  type Agency, type AgencyGroup, type AgentContact, type Branch,
} from '@/data';
import { useSession } from '@/session/SessionContext';
import { usePageMeta } from '@/components/layout/pageMeta';
import { useToast } from '@/components/ui/Toast';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Eyebrow } from '@/components/ui/Eyebrow';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { AgencyCreate } from '@/pages/Agencies/AgencyCreate';
import './OrgManagement.css';

const agencyId = (a: Agency) => `${a.partner || 'northwind'}:${a.name}`;
/** Expand-state keys. Prefixed so a group id can never collide with an agency key. */
const GK = (groupId: string) => `g:${groupId}`;
const AK = (a: Agency) => `a:${agencyId(a)}`;
/** Top-level nodes drawn per page. The tree below them is collapsed by default. */
const PAGE = 50;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** An inline, consequence-aware confirmation rendered inside the contacts modal. */
interface CtConfirm {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  success?: string;
  /** A refusal, not a choice: one dismiss button, no destructive action (#72). */
  blocking?: boolean;
  /** Whether to re-hydrate after the action (mutations yes, a pure discard no). */
  refreshAfter: boolean;
  run: () => Promise<void>;
}

function highlight(name: string, q: string): ReactNode {
  if (!q) return name;
  const i = name.toLowerCase().indexOf(q);
  if (i === -1) return name;
  return (
    <>
      {name.slice(0, i)}
      <mark className="hl">{name.slice(i, i + q.length)}</mark>
      {name.slice(i + q.length)}
    </>
  );
}

function feesOf(item: Agency | Branch, isAgency: boolean): number {
  if (item.fees != null) return item.fees;
  if (isAgency && (item as Agency).branches) return (item as Agency).branches.reduce((s, b) => s + feesOf(b, false), 0);
  return Math.round((item.referrals || 0) * 0.78 * 2180);
}
function fmtK(n: number): string {
  if (n >= 1e6) return `£${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `£${Math.round(n / 1e3)}k`;
  return `£${Math.round(n)}`;
}

const goIcon = <span className="statlink__go"><Icon name="arrowRight" strokeWidth={2.2} /></span>;
const ctInitials = (n: string) => n.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
/** A contact often has no real name (email is the load-bearing field), and older
    records stored the email in the name column. Treat a blank or email-shaped
    name as "no name" so we never render an email address as a person's name (#69). */
const realName = (name: string, email: string): string => {
  const n = (name || '').trim();
  if (!n || n.includes('@') || n.toLowerCase() === (email || '').trim().toLowerCase()) return '';
  return n;
};

/** The deed/contact summary line shown under an agency or branch name.

    TWO RAILS, TWO QUESTIONS. On a supplier-introduced org the agent_contacts
    mailbox IS the deed path, so a missing contact is the warning. On the AGENT
    rail the deed goes to the org's PEOPLE — a nominated recipient, else the
    branch/agency/group manager — so the mailbox says nothing about whether a deed
    can be issued, and warning from it fired on agencies that are perfectly able to
    receive one.

    `ready` carries the people answer, resolved server-side by org_deed_readiness
    for the whole list in one call (it must scale to thousands of rows, so it is
    not recomputed here per row). It is undefined for supplier-introduced orgs and
    in mock mode, and that case keeps the mailbox warning exactly as before. */
function ContactSummary({ agency, branch, canManage, onManage, ready }: { agency: Agency; branch: Branch | null; canManage: boolean; onManage: () => void; ready?: boolean }) {
  const ep = effectivePrimary(agency, branch);
  const manageBtn = canManage ? (
    <button className="contact-manage" onClick={(e) => { e.stopPropagation(); onManage(); }}>Manage</button>
  ) : null;
  const contactLine = ep.contact ? (
    <div className="contact-line">
      <Icon name="mail" />
      <span>{realName(ep.contact.name, ep.contact.email) ? <><b>{realName(ep.contact.name, ep.contact.email)}</b> · {ep.contact.email}</> : <b>{ep.contact.email}</b>}</span>
      {branch && ep.inherited && <span className="cl-inherit">(agency default)</span>}
      {manageBtn}
    </div>
  ) : null;

  if (ready !== undefined) {
    // Agent rail. No Manage button on the warning: the fix is inviting a manager or
    // nominating a recipient on the agency's own page, not editing a mailbox.
    if (!ready) {
      return (
        <div className="contact-line contact-line--none">
          <Icon name="alert" />
          <span className="cl-none">
            {branch
              ? 'No one at this branch can receive the deed. Invite a branch manager or nominate a recipient.'
              : 'No one at this agency can receive the deed. Invite a manager or nominate a recipient.'}
          </span>
        </div>
      );
    }
    // A mailbox is still worth showing when there is one, but on this rail it is
    // information rather than a deed requirement.
    return contactLine;
  }

  if (!ep.contact) {
    // DEFECTS.md 6. This is not a cosmetic gap: a branch with no resolvable
    // primary contact CANNOT ISSUE A DEED, and the failure happens after the
    // tenant has paid. It used to read as a neutral "not filled in yet".
    return (
      <div className="contact-line contact-line--none">
        <Icon name="alert" />
        <span className="cl-none">
          <b>No agent contact.</b> A deed cannot be issued for this branch, and an application against
          it will fail after the tenant has paid.
        </span>
        {manageBtn}
      </div>
    );
  }
  return contactLine;
}

export function OrgManagement() {
  usePageMeta('org', 'Agencies', ['Home', 'Relationships', 'Agencies']);
  const { role, partnerScope, currentUserId, dataVersion, refresh: refreshData } = useSession();
  const toast = useToast();

  const [version, setVersion] = useState(0);
  const refresh = () => setVersion((v) => v + 1);
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');

  /* EXPAND STATE. Groups and agencies are COLLAPSED by default, so a thousand
     agencies is a thousand one-line rows rather than the whole tree. Keys are
     prefixed (GK/AK) so a group and an agency can never collide. Kept per user for
     the session: sessionStorage survives navigating away and back, and does not
     follow them into tomorrow. */
  const expandKey = `org-expand:${currentUserId ?? 'anon'}`;
  const [openSet, setOpenSet] = useState<Set<string>>(() => {
    try {
      const raw = sessionStorage.getItem(`org-expand:${currentUserId ?? 'anon'}`);
      if (raw) return new Set(JSON.parse(raw) as string[]);
    } catch { /* private window or blocked storage: start collapsed, which is correct anyway */ }
    return new Set();
  });
  useEffect(() => {
    try { sessionStorage.setItem(expandKey, JSON.stringify([...openSet])); } catch { /* losing the expand state is not worth an error */ }
  }, [expandKey, openSet]);

  /* How many TOP-LEVEL nodes (groups + independent agencies) are drawn. Collapsed
     rows are cheap, but the top level itself can be thousands, so it is paged. */
  const [shownCount, setShownCount] = useState(PAGE);
  useEffect(() => { setShownCount(PAGE); }, [query]);

  /* Agent-rail deed readiness for every visible agency and branch, resolved
     server-side in ONE call rather than per row. Null (mock mode, or a failure)
     reads as "unknown", which keeps the old agent-contact warning. */
  const [readiness, setReadiness] = useState<DeedReadiness | null>(null);
  useEffect(() => {
    let alive = true;
    getOrgDeedReadiness()
      .then((r) => { if (alive) setReadiness(r); })
      .catch(() => { if (alive) setReadiness(null); });
    return () => { alive = false; };
  }, [dataVersion]);

  // add-agency modal (+ its required default contact)
  // add-branch modal (+ its optional own contact)
  const [branchOpen, setBranchOpen] = useState(false);
  const [branchName, setBranchName] = useState('');
  const [branchArea, setBranchArea] = useState('');
  const [branchAgency, setBranchAgency] = useState('');
  const [branchContact, setBranchContact] = useState({ name: '', email: '', phone: '' });

  // contacts modal (agent contacts on an agency or branch). Editable by Management too.
  const canManageOrg = role === 'superadmin' || role === 'management';
  const canManageContacts = role === 'superadmin' || role === 'management';
  const [ctOpen, setCtOpen] = useState(false);
  const [ctAgencyName, setCtAgencyName] = useState('');
  const [ctBranchName, setCtBranchName] = useState<string | null>(null);
  const [ctEditIndex, setCtEditIndex] = useState<number | null>(null);
  const [ctName, setCtName] = useState('');
  const [ctRole, setCtRole] = useState('');
  const [ctEmail, setCtEmail] = useState('');
  const [ctPhone, setCtPhone] = useState('');
  const [ctPrimary, setCtPrimary] = useState(false);
  const [ctConfirm, setCtConfirm] = useState<CtConfirm | null>(null);

  // Commission editor (superadmin): set this agency's own override, or clear to
  // inherit the next tier up. Server-side set_agency_rates is superadmin-only.
  // Commission is now edited per node on the agency detail page (as percentages),
  // not from a list modal — see AgencyHome. The old fraction-input modal is gone.

  // Group editor (superadmin/management): put a brand (agency) into a real group,
  // create one on the fly, or detach. This is what makes "a whole group" position
  // and the group commission tier reachable, replacing the dead group_name label.
  const [groupAgency, setGroupAgency] = useState<Agency | null>(null);
  const [groupChoice, setGroupChoice] = useState<string>('');
  const [newGroupName, setNewGroupName] = useState('');
  function openGroup(a: Agency) {
    setGroupAgency(a);
    setGroupChoice(a.groupId ?? '');
    setNewGroupName('');
  }
  async function saveGroup() {
    if (!groupAgency?.id) return;
    setBusy(true);
    try {
      let gid: string | null;
      if (groupChoice === 'new') {
        const nm = newGroupName.trim();
        if (!nm) { toast('Enter a name for the new group.', 'error'); setBusy(false); return; }
        gid = (await createAgencyGroup(groupAgency.partner, nm)).id;
      } else {
        gid = groupChoice || null;
      }
      await attachAgencyToGroup(groupAgency.id, gid);
      setGroupAgency(null);
      toast(gid ? 'Agency added to the group.' : 'Agency detached from its group.');
      await refreshData();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not update the group.', 'error');
    } finally {
      setBusy(false);
    }
  }

  const rates = getRatesFor(partnerScope);
  /* THE COMMISSION STATS ON THIS PAGE, and they were gated on the ROLE alone.
     `role === 'management'` is exactly what an agency MANAGER is, so a Manager
     opened Agencies to "Agency commission" on every agency head, again on every
     branch row inside it, and again rolled up on a collapsed group head: the
     agency's earnings at three grains, on a page nobody thought of as a
     commission surface. It is the same mistake RoleOnly was changed to stop
     making, in a file that has no RoleOnly in it, which is why the sweep of the
     other screens did not reach it.
     maySeeCommission, not the role: a Director keeps all three. */
  const isMgmt = role === 'management' && maySeeCommission(role);
  const q = query.trim().toLowerCase();
  // The Agencies section is addressed by the org itself, never by a partner: an
  // admin sees every group/brand/branch; a partner manager sees their own. There
  // is no partner selector on this screen.
  const listScope = role === 'superadmin' ? ALL_PARTNERS : partnerScope;
  /* getAgencies allocates a fresh filtered array on every call, so these are
     memoised on the things that can actually change the org tree: the scope, a
     re-hydration (dataVersion) and a local mutation (version). Without this the
     whole pool is rescanned on every keystroke in the search box. */
  const pool = useMemo(() => getAgencies(listScope), [listScope, version, dataVersion]);

  const partnerPoolForBranch = pool;

  /* DEFECTS.md 6. Branches that cannot issue a deed, surfaced BEFORE an
     application fails against one rather than after.
     effectivePrimary is the client-side twin of effective_primary_contact, which
     is the exact call the deed path makes and the same one GET /v1/orgs reports
     as has_agent_contact, so this cannot disagree with either. */
  // The agent_contacts mailbox warning is correct only for supplier-introduced orgs.
  // Agent-rail orgs (partner referencing_mode 'opndoor_referenced') resolve the deed
  // from their PEOPLE — a nominated recipient, else the branch/agency/group manager —
  // which the agency detail page surfaces per branch; the mailbox check does not apply.
  // Memoised: this walks every agency and every branch and calls getPartner (a
  // linear find) per agency, so unmemoised it ran on every keystroke.
  const deedBlocked = useMemo(() => pool
    // The ESTATE, not the referencing choice. M3 made this follow the agency's own
    // referencing_mode, which was right for an agency opting INTO eligibility and
    // wrong for one opting out: Regent reference their own tenants and are still
    // one of ours, with people to deliver to and no mailbox to warn about.
    .filter((a) => getPartner(a.partner)?.referencingMode !== 'opndoor_referenced')
    .flatMap((a) =>
      a.branches
        .filter((b) => !effectivePrimary(a, b).contact)
        .map((b) => ({ agency: a.name, branch: b.name })),
    ), [pool]);

  // Resolve the contacts-modal owner fresh each render (reflects mutations + re-hydration).
  const ctAgency = ctOpen ? findAgency(ctAgencyName) ?? null : null;
  const ctBranch = ctBranchName && ctAgency ? ctAgency.branches.find((b) => b.name === ctBranchName) ?? null : null;
  const ctContacts: AgentContact[] = (ctBranchName ? ctBranch?.contacts : ctAgency?.contacts) ?? [];
  const ownerLabel = ctBranchName ? ctBranchName : ctAgencyName;

  // Is the contact form holding unsaved input? (drives the item-58 close guard).
  const ctEditing = ctEditIndex !== null ? ctContacts[ctEditIndex] : null;
  const formHasContent = !!(ctName.trim() || ctEmail.trim() || ctRole.trim() || ctPhone.trim());
  const formDirty = ctEditIndex === null
    ? (formHasContent || ctPrimary)
    : (!!ctEditing && (
        ctName !== ctEditing.name || ctEmail !== ctEditing.email ||
        (ctRole || '') !== (ctEditing.role || '') || (ctPhone || '') !== (ctEditing.phone || '') ||
        ctPrimary !== !!ctEditing.primary));

  function openContacts(agencyName: string, branchName: string | null) {
    setCtAgencyName(agencyName);
    setCtBranchName(branchName);
    setCtConfirm(null);
    resetContactForm();
    setCtOpen(true);
  }
  function resetContactForm() {
    setCtEditIndex(null);
    setCtName('');
    setCtRole('');
    setCtEmail('');
    setCtPhone('');
    setCtPrimary(false);
  }
  function startEditContact(index: number) {
    const c = ctContacts[index];
    if (!c) return;
    setCtConfirm(null);
    setCtEditIndex(index);
    setCtName(c.name);
    setCtRole(c.role || '');
    setCtEmail(c.email);
    setCtPhone(c.phone || '');
    setCtPrimary(!!c.primary);
  }

  /** Run a persisting mutation: apply, re-hydrate from the server, toast. */
  async function runOrg(fn: () => Promise<void>, success: string, after?: () => void): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      await refreshData();
      refresh();
      after?.();
      toast(success);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Something went wrong.', 'error');
    } finally {
      setBusy(false);
    }
  }

  /** Run the inline confirm's action (mutations re-hydrate; a discard does not). */
  async function runCtConfirm(): Promise<void> {
    if (!ctConfirm || busy) return;
    const spec = ctConfirm;
    setBusy(true);
    try {
      await spec.run();
      if (spec.refreshAfter) { await refreshData(); refresh(); }
      if (spec.success) toast(spec.success);
      setCtConfirm(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Something went wrong.', 'error');
    } finally {
      setBusy(false);
    }
  }

function submitContact() {
  if (!ctAgency || busy) return;

  const name = ctName.trim();
  const email = ctEmail.trim();

  if (!email) {
    toast('Enter a contact email.');
    return;
  }

  if (!EMAIL_RE.test(email)) {
    toast('Enter a valid contact email.');
    return;
  }

  const rec: AgentContact = {
    name,
    role: ctRole.trim(),
    email,
    phone: ctPhone.trim(),
    primary: ctPrimary,
  };

  const afterSave = () => {
    setCtConfirm(null);      // <-- clear discard dialog
    resetContactForm();      // <-- leave edit mode & clear form
  };

  if (ctEditIndex !== null) {
    const idx = ctEditIndex;
    const orig = ctContacts[idx];
    const otherPrimary = ctContacts.some((c, i) => i !== idx && c.primary);

    if (orig?.primary && !ctPrimary && !otherPrimary) {
      setCtConfirm({
        title: 'Leave no primary contact?',
        body: (
          <>
            <b>{ownerLabel}</b> must keep a primary contact for deed delivery.
            If you save without one, a remaining contact is promoted
            automatically. To move it deliberately, set another contact as
            primary instead.
          </>
        ),
        confirmLabel: 'Save anyway',
        danger: true,
        success: 'Contact updated.',
        refreshAfter: true,
        run: async () => {
          await updateContactLive(ctAgency, ctBranch, idx, orig?.id, rec);
          afterSave();
        },
      });
      return;
    }

    void runOrg(
      () => updateContactLive(ctAgency, ctBranch, idx, orig?.id, rec),
      'Contact updated.',
      afterSave
    );
  } else {
    void runOrg(
      () => addContactLive(ctAgency, ctBranch, rec),
      'Contact added.',
      afterSave
    );
  }
}

  /** The consequence text for removing the contact at index (item 57). */
  function removeConsequence(index: number): ReactNode {
    const c = ctContacts[index];
    const isOnly = ctContacts.length === 1;
    const others = ctContacts.filter((_, i) => i !== index);
    if (!ctBranchName) {
      if (isOnly) {
        const inheriting = (ctAgency?.branches ?? []).filter((b) => !(b.contacts && b.contacts.length)).length;
        return <>This is <b>{ctAgencyName}</b>'s only contact. {inheriting} {inheriting === 1 ? 'branch inherits' : 'branches inherit'} it, so {inheriting === 1 ? 'its' : 'their'} deeds will have no delivery address until you add another. This cannot be undone.</>;
      }
      if (c.primary) return <><b>{c.name}</b> is <b>{ctAgencyName}</b>'s primary contact. Removing them promotes <b>{others[0].name}</b> to primary. This cannot be undone.</>;
      return <>Remove <b>{c.name}</b> from <b>{ctAgencyName}</b>? This cannot be undone.</>;
    }
    if (isOnly) {
      const agDefault = effectivePrimary(ctAgency, null).contact;
      return agDefault
        ? <>This is <b>{ctBranchName}</b>'s only contact. The branch will fall back to the <b>{ctAgencyName}</b> agency default (<b>{agDefault.name}</b>). This cannot be undone.</>
        : <>This is <b>{ctBranchName}</b>'s only contact, and <b>{ctAgencyName}</b> has no contact either, so deeds for this branch will have no delivery address. This cannot be undone.</>;
    }
    if (c.primary) return <><b>{c.name}</b> is this branch's primary contact. Removing them promotes <b>{others[0].name}</b> to primary. This cannot be undone.</>;
    return <>Remove <b>{c.name}</b> from <b>{ctBranchName}</b>? This cannot be undone.</>;
  }

  function askRemoveContact(index: number) {
    if (!ctAgency) return;
    const c = ctContacts[index];
    if (!c) return;
    // #72: an agency's LAST contact cannot be removed - deeds must always have a
    // delivery address. Refuse (do not warn-and-proceed); add a replacement first.
    if (!ctBranchName && ctContacts.length === 1) {
      const inheriting = (ctAgency.branches ?? []).filter((b) => !(b.contacts && b.contacts.length)).length;
      setCtConfirm({
        title: 'Add a replacement contact first',
        body: <><b>{ctAgencyName}</b> must keep at least one contact so its deeds always have a delivery address{inheriting ? <> ({inheriting} {inheriting === 1 ? 'branch inherits' : 'branches inherit'} it)</> : null}. Add a replacement contact below, then remove this one.</>,
        confirmLabel: 'Got it', blocking: true, refreshAfter: false,
        run: async () => {},
      });
      return;
    }
    setCtConfirm({
      title: `Remove ${c.name}?`,
      body: removeConsequence(index),
      confirmLabel: 'Remove contact', danger: true, success: 'Contact removed.', refreshAfter: true,
      run: async () => { await removeContactLive(ctAgency, ctBranch, index, c.id); resetContactForm(); },
    });
  }

  function makePrimary(index: number) {
    if (!ctAgency) return;
    const c = ctContacts[index];
    void runOrg(() => setPrimaryLive(ctAgency, ctBranch, index, c?.id), 'Primary contact updated.');
  }

  // Item 58: pressing Done (or closing) must not silently discard a part-filled form.
function requestCloseContacts() {
  if (busy) return;

  // If there is no unsaved form anymore,
  // clear any old confirmation and close.
  if (!formDirty) {
    setCtConfirm(null);
    setCtOpen(false);
    return;
  }

  setCtConfirm({
    title: 'Discard unsaved contact?',
    body: (
      <>
        You have entered contact details that have not been saved.
        Closing now will discard them.
      </>
    ),
    confirmLabel: 'Discard',
    danger: true,
    refreshAfter: false,
    run: async () => {
      setCtConfirm(null);
      resetContactForm();
      setCtOpen(false);
    },
  });
}

  function toggle(id: string) {
    setOpenSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function onHeadClick(e: MouseEvent, id: string) {
    const target = e.target as HTMLElement;
    if (target.closest('.statlink') || target.closest('[data-stop]')) return;
    toggle(id);
  }

  function openAddBranch(name?: string) {
    setBranchName('');
    setBranchArea('');
    setBranchContact({ name: '', email: '', phone: '' });
    setBranchAgency(name || partnerPoolForBranch[0]?.name || '');
    setBranchOpen(true);
  }
  const branchEmailProvided = !!branchContact.email.trim();
  const branchEmailOk = EMAIL_RE.test(branchContact.email.trim());
  const canSaveBranch = !!branchName.trim() && !!branchAgency && (!branchEmailProvided || branchEmailOk) && !busy;
  function saveBranch() {
    if (!canSaveBranch) return;
    const agency = findAgency(branchAgency);
    if (!agency) { toast('Select a parent agency.'); return; }
    void runOrg(
      () => createBranchLive(agency, {
        name: branchName.trim(), area: branchArea.trim() || undefined,
        contactEmail: branchContact.email.trim() || undefined, contactName: branchContact.name.trim() || undefined, contactPhone: branchContact.phone.trim() || undefined,
      }),
      'Branch added.',
      () => setBranchOpen(false),
    );
  }

  const eyebrow = role === 'superadmin' ? 'opndoor admin' : role === 'management' ? 'Management' : 'Organisation';
  const roleNote: ReactNode =
    // No supplier brand in either branch. Management is a partner user and this
    // is none of their business, and the superadmin string is no safer: it ships
    // in the same bundle any logged-in user can read. Route-gating a screen does
    // not gate the strings on it. See REGRESSION.md section C.
    role === 'superadmin' ? <>As an <b>opndoor admin</b> you have full control: add, edit and reorganise agencies and branches, and sync the hierarchy to the CRM.</>
      : role === 'management' ? <>You can view, add and edit the agencies and branches you manage, and your changes apply straight away. Keeping opndoor's own records in step is handled by <b>opndoor</b>.</>
        : <>You can view every agency and branch. Adding and editing records is handled by your management team and <b>opndoor</b>.</>;

  // Real groups (agency_groups) for the current scope, keyed by id — used both to
  // match a group-name search and to build the group -> brand -> branch tree.
  const listGroups = useMemo(() => getGroups(listScope), [listScope, version, dataVersion]);
  const groupById = useMemo(() => new Map(listGroups.map((g) => [g.id, g])), [listGroups]);

  // Filtered, with expand-all while searching (mirrors org-management.html). A brand
  // matches on its own name OR its group's name, so searching a group keeps all its
  // brands (and their branches) — matching the "Search groups, brands or branches" copy.
  const shownAgencies = useMemo(() => pool
    .map((a) => {
      const groupName = a.groupId ? (groupById.get(a.groupId)?.name.toLowerCase() ?? '') : '';
      const agencyMatch = a.name.toLowerCase().includes(q) || (!!q && groupName.includes(q));
      // A BRANCH-level hit is what auto-expands an agency while searching. An
      // agency-name hit does not: the matching row is the agency itself, and
      // opening its branches would be expanding past the match.
      const branchHit = !!q && a.branches.some((b) => b.name.toLowerCase().includes(q));
      const branches = a.branches.filter((b) => !q || agencyMatch || b.name.toLowerCase().includes(q));
      return { a, agencyMatch, branchHit, branches };
    })
    .filter(({ agencyMatch, branches }) => !(q && !agencyMatch && branches.length === 0)),
    [pool, groupById, q]);

  // Group the shown brands into their real group, so the list is a group -> brand ->
  // branch tree. Brands with no group render at the top level.
  type ShownBrand = (typeof shownAgencies)[number];
  /* The top level of the list — group nodes and independent agencies — as ONE
     sequence, so paging counts what is actually drawn rather than guessing. Only
     the first `shownCount` are rendered, and everything below a COLLAPSED node is
     not rendered at all. */
  type TopNode =
    | { kind: 'group'; group: AgencyGroup; items: ShownBrand[] }
    | { kind: 'agency'; item: ShownBrand };

  const { groupList, topNodes } = useMemo(() => {
    const sections = new Map<string, { group: AgencyGroup; items: ShownBrand[] }>();
    const ungrouped: ShownBrand[] = [];
    for (const item of shownAgencies) {
      const g = item.a.groupId ? groupById.get(item.a.groupId) : undefined;
      if (g) {
        const sec = sections.get(g.id) ?? { group: g, items: [] };
        sec.items.push(item);
        sections.set(g.id, sec);
      } else {
        ungrouped.push(item);
      }
    }
    const gl = [...sections.values()];
    const nodes: TopNode[] = [
      ...gl.map((g) => ({ kind: 'group' as const, group: g.group, items: g.items })),
      ...ungrouped.map((item) => ({ kind: 'agency' as const, item })),
    ];
    return { groupList: gl, topNodes: nodes };
  }, [shownAgencies, groupById]);

  const visibleNodes = topNodes.slice(0, shownCount);

  // Expand-all applies to what is currently listed, which is what the reader means
  // by "all" when a filter is on.
  const expandAll = () => {
    const next = new Set<string>();
    groupList.forEach(({ group }) => next.add(GK(group.id)));
    shownAgencies.forEach(({ a }) => next.add(AK(a)));
    setOpenSet(next);
  };
  const collapseAll = () => setOpenSet(new Set());

  // One brand (an agencies row) with its branches — reused under each group node
  // and for ungrouped brands.
  const renderBrand = ({ a, branchHit, branches }: ShownBrand) => {
    const id = AK(a);
    // While searching, expansion follows the match rather than the saved state, so
    // only the path to a hit opens.
    const open = q ? branchHit : openSet.has(id);
    const fees = feesOf(a, true);
    /* NM-P. NO "1 branch". Matt, 2026-09-30: "A single-office agency shows
       only as the agency... No '1 branch', no branch row, no branch name."
       This line was the literal phrase he named.

       `showsOffices` and not `branches.length !== 1`, because the count has
       to come from the agency's REAL offices: the placeholder "Unattached"
       branches the house rail carries would otherwise make a single-office
       agency look like two and the rule would never fire for it. And it
       reads `a.branches`, never the search-filtered `branches` below --
       typing "Chelsea" narrows a three-office agency to one, and a collapse
       keyed on that would hide a real office name mid-search.

       Zero offices still prints "0 branches", deliberately: an agency with
       no office is a real state this screen exists to surface. */
    const namesOffices = showsOffices(a.name);
    const meta = namesOffices
      ? `${a.branches.length} ${a.branches.length === 1 ? 'branch' : 'branches'}`
      : '';
    return (
      <div className={`agency${open ? ' is-open' : ''}`} key={id}>
        <div className="agency__head" onClick={(e) => onHeadClick(e, id)}>
          <span className="agency__chev"><Icon name="chevronRight" size={18} strokeWidth={2.2} /></span>
          <span className="agency__ic"><Icon name="org" /></span>
          <div className="agency__txt">
            <Link className="agency__name agency__namelink" to={`/agencies/${encodeURIComponent(a.id ?? a.name)}`} data-stop title={`Open ${a.name}`}>{highlight(a.name, q)}</Link>
            {meta && <div className="agency__meta">{meta}</div>}
            <ContactSummary agency={a} branch={null} canManage={canManageContacts} onManage={() => openContacts(a.name, null)} ready={a.id ? readiness?.agencies.get(a.id) : undefined} />
          </div>
          <Link className="statlink statlink--agency" to={`/applications?agency=${encodeURIComponent(a.name)}`} title={`View all applications for ${a.name}`}>
            <div className="agency__stat"><div className="n">{a.referrals}</div><div className="l">Referrals</div></div>
            <div className="agency__stat"><div className="n">{fmtK(fees)}</div><div className="l">Fees collected</div></div>
            {isMgmt && <div className="agency__stat"><div className="n">{fmtK(fees * rates.agent)}</div><div className="l">Agency commission</div></div>}
            {goIcon}
          </Link>
          {role === 'superadmin' && (
            <div className="agency__actions" data-stop>
              {a.id && <button className="iconbtn iconbtn--sm" title="Group" onClick={() => openGroup(a)}><Icon name="org" /></button>}
              <button className="iconbtn iconbtn--sm" title="Edit"  onClick={() => openContacts(a.name, null)}><Icon name="edit" /></button>
            </div>
          )}
        </div>
        {/* UNMOUNTED when closed, not merely hidden. The old tree rendered every
            branch and let CSS display:none it, so "collapsed" cost exactly as much
            DOM as expanded — which is the thing that has to stop at a thousand
            agencies. */}
        {open && (
        <div className="branches">
          {/* NM-P. NO BRANCH ROW for a single-office agency. Its referrals,
              fees and commission are already on the agency head above and
              are the same numbers, and its contact line is already there
              too, so the row said nothing the head did not.

              THE CONTAINER STAYS EVEN SO, and this is the trap the whole
              item turns on: "Add branch" lives inside it, and Matt's
              instruction keeps that -- "'Add branch' stays available on the
              agency". Hiding the rows by hiding the block would delete the
              one control he asked to keep. */}
          {!namesOffices && !q && (
            <div className="branch__meta" style={{ padding: '6px 0 2px 28px' }}>
              One office, which is the agency itself. Add a second and both will show here.
            </div>
          )}
          {namesOffices && branches.map((b) => {
            const bFees = feesOf(b, false);
            return (
              <div className="branch" key={b.name}>
                <span className="branch__line">│</span>
                <span className="branch__ic"><Icon name="home" /></span>
                <div className="branch__txt">
                  <div className="branch__name">{highlight(b.name, q)}</div>
                  <div className="branch__meta">{b.area}</div>
                  <ContactSummary agency={a} branch={b} canManage={canManageContacts} onManage={() => openContacts(a.name, b.name)} ready={b.id ? readiness?.branches.get(b.id) : undefined} />
                </div>
                <Link className="statlink statlink--branch" to={`/applications?branch=${encodeURIComponent(b.name)}`} title={`View applications for ${b.name}`}>
                  <div className="branch__stat"><b>{b.referrals}</b>referrals</div>
                  <div className="branch__stat"><b>{fmtK(bFees)}</b>fees collected</div>
                  {isMgmt && <div className="branch__stat"><b>{fmtK(bFees * rates.agent)}</b>agency comm.</div>}
                  {goIcon}
                </Link>
              </div>
            );
          })}
          {!q && canManageOrg && (
            <div className="branch__add">
              <Button variant="ghost" size="sm" onClick={() => openAddBranch(a.name)}><Icon name="plus" /> Add branch</Button>
            </div>
          )}
        </div>
        )}
      </div>
    );
  };

  return (
    <>
      {/* DEFECTS.md 6. Visible before an application fails, which is the whole
          point: the condition was previously only discoverable by opening each
          branch, or by a tenant paying for a deed that could not be issued. */}
      {deedBlocked.length > 0 && (
        <div className="org-blocked">
          <Icon name="alert" />
          <div>
            <strong>
              {deedBlocked.length} branch{deedBlocked.length === 1 ? '' : 'es'} cannot issue a deed
            </strong>
            <p>
              No agent contact resolves for them. An application against one of these will be accepted,
              the tenant will pay, and the deed will then fail. Add a contact, or set one as primary.
            </p>
            <p className="org-blocked__list">
              {deedBlocked.slice(0, 8).map((b) => `${b.agency} \u00b7 ${b.branch}`).join(', ')}
              {deedBlocked.length > 8 && ` and ${deedBlocked.length - 8} more`}
            </p>
          </div>
        </div>
      )}

      <div className="page-head">
        <div>
          <Eyebrow>{eyebrow}</Eyebrow>
          <h1 className="page-head__title" style={{ marginTop: 10 }}>Agencies</h1>
          <p className="page-head__sub">The group → agency → branch hierarchy. Search a group, agency or branch, expand to see branches, or click any figure to view the applications behind it.</p>
        </div>
        <div className="page-head__actions">
          {/* Opndoor onboards agencies: admin_create_agency_and_branch refuses
              anyone but an admin, so drawing this for an agency manager offered a
              button that could only fail. Add BRANCH stays on canManageOrg, which
              management may genuinely do. */}
          {role === 'superadmin' && (
            <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}><Icon name="plus" /> Add agency</Button>
          )}
        </div>
      </div>

      <div className="rolenote" style={{ marginBottom: 18 }}>
        <Icon name="shield" />
        <span>{roleNote}</span>
      </div>

      <div className={`org-search${query.trim() ? ' has-q' : ''}`}>
        <Icon name="search" />
        <input type="text" placeholder="Search groups, agencies or branches" autoComplete="off" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className="org-search__clear" aria-label="Clear search" onClick={() => setQuery('')}><Icon name="x" size={16} /></button>
      </div>

      {topNodes.length > 0 && (
        <div className="org-tools">
          <div className="org-tools__count">
            Showing <b>{Math.min(shownCount, topNodes.length)}</b> of {topNodes.length} {topNodes.length === 1 ? 'row' : 'rows'}
            {' · '}{shownAgencies.length} {shownAgencies.length === 1 ? 'agency' : 'agencies'}
          </div>
          {/* While searching, expansion follows the match, so these would be dead. */}
          {!q && (
            <div className="org-tools__actions">
              <button type="button" className="org-tools__btn" onClick={expandAll}>Expand all</button>
              <button type="button" className="org-tools__btn" onClick={collapseAll}>Collapse all</button>
            </div>
          )}
        </div>
      )}

      <div className="org">
        {visibleNodes.map((node) => {
          if (node.kind === 'agency') return renderBrand(node.item);
          const { group, items } = node;
          const brandCount = items.length;
          const branchCount = items.reduce((s, it) => s + it.a.branches.length, 0);
          // Rolled up from the agencies underneath, so a collapsed group still
          // answers "how much business is in here?" without being opened.
          const groupRefs = items.reduce((s, it) => s + (it.a.referrals || 0), 0);
          const groupFees = items.reduce((s, it) => s + feesOf(it.a, true), 0);
          const gOpen = q ? true : openSet.has(GK(group.id));
          return (
            <div className={`orggroup${gOpen ? ' is-open' : ''}`} key={group.id}>
              <div className="orggroup__head" onClick={(e) => onHeadClick(e, GK(group.id))}>
                <span className="orggroup__chev"><Icon name="chevronRight" size={18} strokeWidth={2.2} /></span>
                <span className="orggroup__tick">G</span>
                <div className="orggroup__txt">
                  <Link className="orggroup__name" to={`/agencies/${encodeURIComponent(group.id)}`} data-stop title={`Open ${group.name}`}>{highlight(group.name, q)}</Link>
                  <div className="orggroup__meta">{brandCount} {brandCount === 1 ? 'agency' : 'agencies'} · {branchCount} {branchCount === 1 ? 'branch' : 'branches'}</div>
                </div>
                <div className="orggroup__stats">
                  <div className="agency__stat"><div className="n">{groupRefs}</div><div className="l">Referrals</div></div>
                  <div className="agency__stat"><div className="n">{fmtK(groupFees)}</div><div className="l">Fees collected</div></div>
                  {isMgmt && <div className="agency__stat"><div className="n">{fmtK(groupFees * rates.agent)}</div><div className="l">Agency commission</div></div>}
                </div>
              </div>
              {/* Unmounted when closed, so a collapsed group costs one row. */}
              {gOpen && (
                <div className="orggroup__brands">
                  {items.map(renderBrand)}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {shownCount < topNodes.length && (
        <div className="org-more">
          <Button variant="ghost" size="sm" onClick={() => setShownCount((n) => n + PAGE)}>
            Show {Math.min(PAGE, topNodes.length - shownCount)} more
          </Button>
        </div>
      )}
      <div className={`org-empty${shownAgencies.length ? '' : ' is-shown'}`}>No groups, agencies or branches match your search.</div>

      {/* Agency onboarding flow (name, first branch + address, commission, first invite). */}
      <AgencyCreate open={createOpen} onClose={() => setCreateOpen(false)} />

      {/* ADD BRANCH */}
      <Modal
        open={branchOpen}
        onClose={() => { if (!busy) setBranchOpen(false); }}
        title="Add branch"
        sub="Add a branch to an agency. A branch with no contact of its own inherits the agency default."
        footer={<><Button variant="ghost" onClick={() => setBranchOpen(false)} disabled={busy}>Cancel</Button><Button variant="primary" onClick={saveBranch} disabled={!canSaveBranch}>{busy ? 'Saving…' : 'Save branch'}</Button></>}
      >
        <Field label="Branch name" htmlFor="branch-name"><input id="branch-name" type="text" placeholder="e.g. Notting Hill" autoComplete="off" value={branchName} onChange={(e) => setBranchName(e.target.value)} /></Field>
        <Field label="Postcode / area" htmlFor="branch-area" hint="Optional"><input id="branch-area" type="text" placeholder="e.g. W11" autoComplete="off" value={branchArea} onChange={(e) => setBranchArea(e.target.value)} /></Field>
        <Field label="Parent agency" htmlFor="branch-agency">
          <select id="branch-agency" value={branchAgency} onChange={(e) => setBranchAgency(e.target.value)}>
            {partnerPoolForBranch.map((a) => <option key={agencyId(a)} value={a.name}>{a.name}</option>)}
          </select>
        </Field>
        <div style={{ borderTop: '1px solid var(--line)', paddingTop: 14, marginTop: 6 }}>
          <div style={{ fontFamily: 'var(--display)', fontWeight: 700, fontSize: 13.5, marginBottom: 4 }}>Branch contact <span style={{ fontWeight: 400, color: 'var(--ink-mute)' }}>(optional)</span></div>
          <p style={{ fontSize: 12.5, color: 'var(--ink-mute)', margin: '0 0 12px' }}>Leave blank to inherit the agency default contact.</p>
          <div className="form-grid">
            <Field span2 label="Contact email" htmlFor="branch-cemail" hint="Optional"><input id="branch-cemail" type="email" placeholder="branch@agency.co.uk" autoComplete="off" value={branchContact.email} onChange={(e) => setBranchContact((c) => ({ ...c, email: e.target.value }))} /></Field>
            <Field label="Contact name" htmlFor="branch-cname" hint="Optional"><input id="branch-cname" type="text" placeholder="e.g. Sam Rivers" autoComplete="off" value={branchContact.name} onChange={(e) => setBranchContact((c) => ({ ...c, name: e.target.value }))} /></Field>
            <Field label="Contact phone" htmlFor="branch-cphone" hint="Optional"><input id="branch-cphone" type="tel" placeholder="020 7946 0000" autoComplete="off" value={branchContact.phone} onChange={(e) => setBranchContact((c) => ({ ...c, phone: e.target.value }))} /></Field>
          </div>
        </div>
      </Modal>

      {/* MANAGE AGENT CONTACTS */}
      <Modal
        open={ctOpen}
        onClose={requestCloseContacts}
        title={`${ctBranchName || ctAgencyName} contacts`}
        sub={ctBranchName ? 'Agent contacts for this branch. Who the Deed of Guarantee is sent to.' : 'Agency contacts. Used as the default for branches with no contact of their own.'}
        footer={<Button variant="primary" onClick={requestCloseContacts} disabled={busy}>Done</Button>}
      >
        {ctConfirm && (
          <div className={`ct-confirm${ctConfirm.danger ? ' is-danger' : ''}`}>
            <div className="ct-confirm__title">{ctConfirm.title}</div>
            <div className="ct-confirm__body">{ctConfirm.body}</div>
            <div className="ct-confirm__actions">
              {ctConfirm.blocking ? (
                <Button variant="primary" size="sm" onClick={() => setCtConfirm(null)} disabled={busy}>{ctConfirm.confirmLabel}</Button>
              ) : (
                <>
                  <Button variant="ghost" size="sm" onClick={() => setCtConfirm(null)} disabled={busy}>Cancel</Button>
                  <Button variant="primary" size="sm" className={ctConfirm.danger ? 'btn--danger' : undefined} onClick={runCtConfirm} disabled={busy}>{busy ? 'Working…' : ctConfirm.confirmLabel}</Button>
                </>
              )}
            </div>
          </div>
        )}

        {ctBranchName && ctContacts.length === 0 && (
          <div className="ct-inherit-note">
            {effectivePrimary(ctAgency, ctBranch).contact ? (
              <>This branch has no contact of its own, so it uses the <b>{ctAgencyName}</b> agency default (<b>{effectivePrimary(ctAgency, ctBranch).contact!.name}</b>). Add a contact below to override it for this branch.</>
            ) : (
              <>This branch has no contact of its own, and the agency has none either. Add a branch contact below, or add an agency contact to cover all its branches.</>
            )}
          </div>
        )}

        <div>
          {ctContacts.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--ink-mute)', padding: '6px 0 14px' }}>No contacts yet.</p>
          ) : (
            ctContacts.map((c, i) => (
              <div className="ct-row" key={c.id ?? i}>
                <span className="ct-av">{ctInitials(c.name)}</span>
                <div className="ct-main">
                  <div className="ct-name word_wrap">{realName(c.name, c.email) || c.email}{c.primary && <span className="ct-primary">Primary</span>}</div>
                  <div className="ct-sub word_wrap">{[c.role, realName(c.name, c.email) ? c.email : null, c.phone].filter(Boolean).join(' · ')}</div>
                </div>
                <div className="ct-actions">
                  {!c.primary && <button onClick={() => makePrimary(i)} disabled={busy}>Set primary</button>}
                  <button onClick={() => startEditContact(i)} disabled={busy}>Edit</button>
                  <button onClick={() => askRemoveContact(i)} disabled={busy}>Remove</button>
                </div>
              </div>
            ))
          )}
        </div>

        <div style={{ borderTop: '1px solid var(--line)', paddingTop: 16, marginTop: 6 }}>
          <div style={{ fontFamily: 'var(--display)', fontWeight: 700, fontSize: 13.5, marginBottom: 4 }}>{ctEditIndex !== null ? 'Edit contact' : 'Add a contact'}</div>
          <p style={{ fontSize: 12.5, color: 'var(--ink-mute)', margin: '0 0 12px' }}>The email is what matters. It is where the Deed of Guarantee is delivered.</p>
          <div className="form-grid">
            <Field span2 label={<>Contact email <span className="req" aria-hidden="true">*</span></>} htmlFor="ct-email"><input id="ct-email" type="email" placeholder="deeds@agency.co.uk" autoComplete="off" value={ctEmail} onChange={(e) => setCtEmail(e.target.value)} /></Field>
            <div className="field span-2" style={{ marginTop: -6 }}><span className="hint">Use a shared work address (e.g. deeds@agency.co.uk) rather than a personal one. Deeds must always deliver, even when staff change.</span></div>
            <Field label="Name" htmlFor="ct-name" hint="Optional"><input id="ct-name" type="text" placeholder="e.g. Deeds team" autoComplete="off" value={ctName} onChange={(e) => setCtName(e.target.value)} /></Field>
            <Field label="Role" htmlFor="ct-role" hint="Optional"><input id="ct-role" type="text" placeholder="e.g. Branch manager" autoComplete="off" value={ctRole} onChange={(e) => setCtRole(e.target.value)} /></Field>
            <Field className="span-2" label="Phone" htmlFor="ct-phone" hint="Optional"><input id="ct-phone" type="text" autoComplete="off" value={ctPhone} onChange={(e) => setCtPhone(e.target.value)} /></Field>
            <label className="field span-2" style={{ flexDirection: 'row', alignItems: 'center', gap: 9, display: 'flex' }}>
              <input type="checkbox" checked={ctPrimary} onChange={(e) => setCtPrimary(e.target.checked)} style={{ width: 'auto' }} />
              <span style={{ fontSize: 13, color: 'var(--ink-soft)', fontWeight: 600, textTransform: 'none', letterSpacing: 0 }}>Primary contact (receives the deed by default)</span>
            </label>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <Button variant="primary" size="sm" onClick={submitContact} disabled={busy}>{ctEditIndex !== null ? 'Save contact' : 'Add contact'}</Button>
            {ctEditIndex !== null && <Button variant="ghost" size="sm" onClick={resetContactForm} disabled={busy}>Cancel edit</Button>}
          </div>
        </div>
      </Modal>


      {/* Group editor: put a brand into a real agency_groups row, create one, or detach. */}
      <Modal
        open={!!groupAgency}
        onClose={() => setGroupAgency(null)}
        width={460}
        title={`Group: ${groupAgency?.name ?? ''}`}
        sub="Put this agency into a group. A group is the top commission tier and can be covered by a single director's position."
        footer={
          <>
            <Button variant="ghost" onClick={() => setGroupAgency(null)} disabled={busy}>Cancel</Button>
            <Button variant="primary" onClick={() => void saveGroup()} disabled={busy}>{busy ? 'Saving…' : 'Save group'}</Button>
          </>
        }
      >
        {groupAgency && (
          <div className="form-grid">
            <Field label="Group" span2 hint="Groups available for this agency.">
              <select value={groupChoice} onChange={(e) => setGroupChoice(e.target.value)}>
                <option value="">None (ungrouped)</option>
                {getGroups(groupAgency.partner).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                <option value="new">＋ New group…</option>
              </select>
            </Field>
            {groupChoice === 'new' && (
              <Field label="New group name" span2>
                <input type="text" value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} placeholder="Northgate Property Group" />
              </Field>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
