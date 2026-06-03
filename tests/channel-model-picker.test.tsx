import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";

import { ChannelModelPicker } from "../components/ChannelModelPicker";
import type { ModelInfo } from "../src/schemas";

const textCapableModel: ModelInfo = {
  id: "fal-ai/ideogram/v3",
  name: "Ideogram v3",
  kind: "image",
  capabilities: {
    supportsOnImageText: true,
    textToImage: true
  },
  tags: ["supports-on-image-text"]
};

const gptImage2Model: ModelInfo = {
  id: "openai/gpt-image-2",
  name: "GPT Image 2",
  kind: "image",
  capabilities: {
    supportsOnImageText: true
  },
  tags: ["supports-on-image-text"]
};

describe("ChannelModelPicker", () => {
  it("warns and blocks unresolved text-capable model conflicts on no-text channels", () => {
    const onChange = vi.fn();

    render(
      <ChannelModelPicker
        channel="website"
        value={{
          imageModelId: "fal-ai/ideogram/v3",
          imageModel: textCapableModel,
          forceNoTextMode: false
        }}
        onChange={onChange}
      />
    );

    expect(
      screen.getByText("This model bakes text into images.")
    ).toBeInTheDocument();
    expect(screen.getByText("Conflict unresolved")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Yes, force no-text mode"));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ forceNoTextMode: true })
    );
  });

  it("lets GPT Image 2 users choose quality", () => {
    const onChange = vi.fn();

    render(
      <ChannelModelPicker
        channel="meta"
        value={{
          imageModelId: gptImage2Model.id,
          imageModel: gptImage2Model,
          imageOptions: {
            quality: "low"
          }
        }}
        onChange={onChange}
      />
    );

    expect(screen.getByLabelText("GPT Image 2 quality")).toHaveValue("low");

    fireEvent.change(screen.getByLabelText("GPT Image 2 quality"), {
      target: { value: "medium" }
    });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        imageOptions: {
          quality: "medium"
        }
      })
    );
  });
});
