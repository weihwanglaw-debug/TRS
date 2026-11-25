import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import ParticipantFieldsForm, { blankParticipantFormValues, validateParticipant } from "@/components/registration/ParticipantFieldsForm";
import type { ProgramFields } from "@/types/config";
vi.mock("@/lib/api", () => ({ apiGetBadmintonClubs: async () => ({data: []}) }));
let root: Root | undefined;
let container: HTMLDivElement;
afterEach(() => { if(root) act(() => root!.unmount()); root = undefined; container?.remove(); });
const fields = { customFields: [] } as unknown as ProgramFields;
it.each([[false, false, false], [true, false, true], [false, true, true], [undefined, false, true]])(
  "matches visibility and validation for sports=%s team=%s", async (isSports, teamMode, required) => {
    const values = blankParticipantFormValues();
    const errors = validateParticipant(values, { program: {minAge:0,maxAge:99,gender:"Open",fields}, isSports, teamMode });
    expect(!!errors.clubSchoolCompany).toBe(required);
    values.clubSchoolCompany = "Existing affiliation";
    const onChange = vi.fn();
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    await act(async () => root!.render(<ParticipantFieldsForm values={values} onChange={onChange} programFields={fields} errors={{}} isSports={isSports} teamMode={teamMode} />));
    expect(container.textContent?.includes(teamMode ? "Team name *" : "Club / School / Company *")).toBe(required);
    expect(onChange).not.toHaveBeenCalled();
    expect(values.clubSchoolCompany).toBe("Existing affiliation");
  });
it("still requires a custom Company field for non-sport registrations", () => {
  const customFields = [{id:"company",label:"Company",type:"text",required:true}];
  const errors = validateParticipant(blankParticipantFormValues(), {program:{minAge:0,maxAge:99,gender:"Open",fields:{...fields,customFields} as ProgramFields},isSports:false});
  expect(errors.clubSchoolCompany).toBeUndefined();
  expect(errors["custom.Company"]).toBeTruthy();
});

