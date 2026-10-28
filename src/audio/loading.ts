/** Wait for overlay removal or its actual fade (the scene's error veil can stay mounted). No polling. */
export function afterAudioReveal(root: ParentNode, ready: () => void): () => void {
  let active = true;
  const fading = new WeakSet<Element>();
  const revealed = new WeakSet<Element>();
  const observer = new MutationObserver(() => check());
  const cancel = () => {
    active = false;
    observer.disconnect();
  };
  const check = () => {
    if (!active) return;
    let blocked = false;
    for (const el of root.querySelectorAll('.loading, .loading-veil')) {
      if (revealed.has(el)) continue;
      blocked = true;
      if (fading.has(el) || !el.matches('.fade, .gone')) continue;
      fading.add(el);
      void Promise.allSettled(el.getAnimations().map((a) => a.finished)).then(() => {
        if (el.matches('.fade, .gone')) revealed.add(el);
        fading.delete(el);
        check();
      });
    }
    if (!blocked) {
      cancel();
      ready();
    }
  };
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  check();
  return cancel;
}
