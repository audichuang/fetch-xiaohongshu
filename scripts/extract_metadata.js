() => {
  const state = window.__INITIAL_STATE__;
  if (!state || !state.note || !state.note.noteDetailMap) return { error: 'no __INITIAL_STATE__' };
  const noteId = Object.keys(state.note.noteDetailMap)[0];
  const note = state.note.noteDetailMap[noteId].note;
  return {
    type: note.type,
    title: note.title || '',
    desc: note.desc || '',
    author: note.user ? note.user.nickname : '',
    tags: (note.tagList || []).map(t => t.name),
    imageCount: note.imageList ? note.imageList.length : 0,
    videoUrl: (note.video && note.video.media && note.video.media.stream && note.video.media.stream.h264 && note.video.media.stream.h264[0])
      ? note.video.media.stream.h264[0].masterUrl : null
  };
}
