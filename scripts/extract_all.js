() => {
    const state = window.__INITIAL_STATE__;
    if (!state || !state.note || !state.note.noteDetailMap)
        return { error: 'no __INITIAL_STATE__' };

    const noteId = Object.keys(state.note.noteDetailMap)
        .find(k => k !== 'null' && k !== 'undefined');
    if (!noteId) return { error: 'noteId not found' };

    const note = state.note.noteDetailMap[noteId].note;

    // Extract image URLs from state (complete, no lazy-load issues)
    // infoList last item = highest quality; fallback to urlDefault/url
    const imageUrls = (note.imageList || []).map(img => {
        const best = img.infoList && img.infoList.length > 0
            ? img.infoList[img.infoList.length - 1].url
            : (img.urlDefault || img.url || '');
        return best.replace(/^http:\/\//, 'https://');
    });

    return {
        type: note.type,
        title: note.title || '',
        desc: note.desc || '',
        author: note.user ? note.user.nickname : '',
        tags: (note.tagList || []).map(t => t.name),
        imageCount: note.imageList ? note.imageList.length : 0,
        imageUrls: imageUrls,
        videoUrl: (note.video && note.video.media && note.video.media.stream
            && note.video.media.stream.h264 && note.video.media.stream.h264[0])
            ? note.video.media.stream.h264[0].masterUrl : null
    };
}
