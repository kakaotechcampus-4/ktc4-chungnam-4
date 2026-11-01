import { create } from "zustand";
import type { LoginInput } from "@/api/auth";

// FR-23: 비밀번호는 화면 사이 메모리로만 전달합니다. URL·history·영구 저장소에는 쓰지 않습니다.
export const useSignupCredentials = create<{
  credentials: LoginInput | null;
  set: (credentials: LoginInput | null) => void;
}>((set) => ({ credentials: null, set: (credentials) => set({ credentials }) }));
