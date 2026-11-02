// #231은 사진 연결만 배포합니다. child-links·STT가 함께 들어가는 #232에서 켭니다.
export const CLIPS_ENABLED = false;

export const UPLOAD_GUIDE = CLIPS_ENABLED
  ? "사진 JPG·PNG·HEIC · 영상 MP4·MOV · 녹음 M4A·WAV"
  : "지금은 사진(JPG·PNG·HEIC)만 올릴 수 있어요. 영상·녹음은 준비 중이에요.";
