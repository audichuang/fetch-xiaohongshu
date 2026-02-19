() => {
  // Find the large image closest to viewport center (handles carousels correctly)
  const imgs = [...document.querySelectorAll('img')]
    .filter(img => img.naturalWidth > 200 && img.naturalHeight > 200);
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  const best = imgs.reduce((acc, img) => {
    const r = img.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return acc;
    const dist = Math.abs(r.left + r.width / 2 - cx) + Math.abs(r.top + r.height / 2 - cy);
    return (!acc || dist < acc.dist) ? { img, dist } : acc;
  }, null);
  if (!best) return { error: 'no visible image found' };
  try {
    const c = document.createElement('canvas');
    c.width = best.img.naturalWidth;
    c.height = best.img.naturalHeight;
    c.getContext('2d').drawImage(best.img, 0, 0);
    return c.toDataURL('image/webp').split(',')[1];
  } catch(e) {
    return { error: e.message, name: e.name };
  }
}
