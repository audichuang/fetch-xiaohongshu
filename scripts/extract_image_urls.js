() => {
  const imgs = [...document.querySelectorAll('img')]
    .filter(img => img.naturalWidth > 200 && img.naturalHeight > 200
                && img.currentSrc.includes('xhscdn'));
  return [...new Set(imgs.map(img => img.currentSrc))];
}
