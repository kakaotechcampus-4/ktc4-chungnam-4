// #232는 child-links·STT·발화 검수를 함께 제공하므로 영상·음성 업로드를 허용합니다.
export const CLIPS_ENABLED = true;

export const UPLOAD_GUIDE = CLIPS_ENABLED
  ? "사진 JPG·PNG·HEIC · 영상 MP4·MOV · 녹음 M4A·WAV"
  : "지금은 사진(JPG·PNG·HEIC)만 올릴 수 있어요. 영상·녹음은 준비 중이에요.";
