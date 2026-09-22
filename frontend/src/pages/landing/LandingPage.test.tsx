import { screen } from "@testing-library/react";

import { renderRoute } from "@/test/render";

import { LandingPage } from "./LandingPage";

describe("LandingPage", () => {
  it("서비스 이름을 보여 준다", async () => {
    renderRoute(<LandingPage />);

    expect(await screen.findByRole("heading", { name: "아이담" })).toBeInTheDocument();
  });
});
