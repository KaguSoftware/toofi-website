// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ params: new URLSearchParams() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => nav.params }));

const { ContactForm } = await import("./ContactForm");

beforeEach(() => {
  nav.params = new URLSearchParams();
});

describe("ContactForm", () => {
  it("prefills the residence and compound chosen in the finder", () => {
    nav.params = new URLSearchParams("residence=bd-v03");
    render(<ContactForm locale="en" />);
    expect((screen.getByLabelText(/Residence/) as HTMLInputElement).value).toBe("BD-V03");
    expect((screen.getByLabelText("Compound") as HTMLSelectElement).value).toBe("bustan-dijla");
    expect(screen.getByText(/Filled in from the residence you chose/)).toBeDefined();
  });

  it("selects the partner interest from the URL and hides buyer-only fields", () => {
    nav.params = new URLSearchParams("interest=landowner");
    render(<ContactForm locale="en" />);
    expect((screen.getByLabelText("A landowner") as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByLabelText("Compound")).toBeNull();
  });

  it("shows inline errors and a summary instead of submitting an invalid form", () => {
    render(<ContactForm locale="en" />);
    fireEvent.click(screen.getByRole("button", { name: "Send enquiry" }));
    expect(screen.getByRole("alert").textContent).toBe("Check the fields marked below.");
    const name = screen.getByLabelText("Full name");
    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(name.getAttribute("aria-describedby")!)!.textContent).toContain("Enter your name.");
    expect(screen.getByText("Tick the box so an adviser can reply.")).toBeDefined();
  });

  it("never fakes success: a valid demo submission says nothing was sent, and can be edited", () => {
    render(<ContactForm locale="en" />);
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Zainab Ali" } });
    fireEvent.change(screen.getByLabelText("Phone or WhatsApp"), { target: { value: "0770 123 4567" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Send enquiry" }));
    expect(screen.getByRole("heading", { name: "Nothing was sent" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Edit the enquiry" }));
    expect((screen.getByLabelText("Full name") as HTMLInputElement).value).toBe("Zainab Ali");
  });

  it("asks for an email when email is the chosen contact method", () => {
    render(<ContactForm locale="ar" />);
    fireEvent.click(screen.getByLabelText("البريد الإلكتروني", { selector: "input[type=radio]" }));
    fireEvent.click(screen.getByRole("button", { name: "أرسل الاستفسار" }));
    expect(screen.getByText("أضف بريدك الإلكتروني لنتواصل معك عبره.")).toBeDefined();
  });
});
