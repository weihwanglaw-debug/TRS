import type { Feature, SheetData } from "write-excel-file/browser";
import type { Program, TournamentEvent, CustomField } from "@/types/config";
import { NATIONALITY_OPTIONS } from "@/lib/countries";
import { TSHIRT_SIZES } from "@/components/registration/ParticipantFieldsForm";
import { apiGetBadmintonClubs } from "@/lib/api";

const TEMPLATE_ROW_COUNT = 200;
const ENTRY_SHEET = "Participant Entries";
const INFO_SHEET = "Template Info";
const OPTIONS_SHEET = "Dropdown Options";
const HEADER_ROW_NUMBER = 5;
const FIRST_DATA_ROW_NUMBER = HEADER_ROW_NUMBER + 1;
const LAST_DATA_ROW_NUMBER = FIRST_DATA_ROW_NUMBER + TEMPLATE_ROW_COUNT - 1;
const CLUB_NO_CLUB_VALUE = "* No Club";
const ROW_TYPE_COLUMN = "Row Type";
const SAMPLE_ROW_TYPE = "SAMPLE";

type TemplateColumnType = "text" | "number" | "date" | "select";

interface TemplateColumn {
  label: string;
  required?: boolean;
  type: TemplateColumnType;
  options?: string[];
  allowFreeText?: boolean;
  width: number;
  note?: string;
}

interface ValidationRule {
  columnIndex: number;
  type: TemplateColumnType;
  options?: string[];
  definedName?: string;
  allowFreeText?: boolean;
}

interface OptionRange {
  label: string;
  definedName: string;
  columnIndex: number;
  optionCount: number;
}

function safeFilename(value: string) {
  return value.replace(/[/\\?%*:|"<>]/g, "-");
}

function xmlEscape(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function columnLetter(columnIndex: number) {
  let n = columnIndex + 1;
  let result = "";
  while (n > 0) {
    const remainder = (n - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

function splitOptions(value?: string) {
  return (value ?? "")
    .split(",")
    .map(option => option.trim())
    .filter(Boolean);
}

function customFieldKey(cf: CustomField, index: number) {
  const id = cf.customFieldId ?? cf.id;
  return id ? `Custom:${id}` : `Custom:${cf.label || `Field ${index + 1}`}`;
}

function definedNameForColumn(label: string, index: number) {
  const clean = label.replace(/[^A-Za-z0-9_]/g, "_").replace(/^(\d)/, "_$1").slice(0, 40);
  return `TRS_${index + 1}_${clean || "Options"}`;
}

function requiredLabel(column: TemplateColumn) {
  return `${column.label}${column.required ? " *" : ""}`;
}

function genderOptions(program: Program) {
  if (program.gender === "Male") return ["Male"];
  if (program.gender === "Female") return ["Female"];
  return ["Male", "Female"];
}

function isBadmintonTemplate(event: TournamentEvent, program: Program) {
  void program;
  return event.sportType?.trim().toLowerCase() === "badminton";
}

function buildColumns(event: TournamentEvent, program: Program, badmintonClubOptions: string[]): TemplateColumn[] {
  const fields = program.fields;
  const useBadmintonClubDropdown = isBadmintonTemplate(event, program);
  const columns: TemplateColumn[] = [
    { label: ROW_TYPE_COLUMN, type: "select", options: [SAMPLE_ROW_TYPE, "DATA"], width: 14, note: "Use SAMPLE for sample rows. Leave blank or use DATA for rows to import." },
    { label: "Entry No", required: true, type: "number", width: 12, note: "Use the same Entry No for players in the same doubles/team entry." },
    { label: "Full Name", required: true, type: "text", width: 28 },
    { label: "Date of Birth", required: true, type: "date", width: 16, note: "Use yyyy-mm-dd." },
    { label: "Gender", required: true, type: "select", options: genderOptions(program), width: 14 },
    { label: "Email", required: true, type: "text", width: 28 },
    { label: "Contact Number", required: true, type: "text", width: 18 },
    {
      label: "Nationality",
      required: true,
      type: "select",
      options: NATIONALITY_OPTIONS.map(option => `${option.code} - ${option.label}`),
      width: 24,
    },
    {
      label: "Club / Team / School",
      required: true,
      type: useBadmintonClubDropdown ? "select" : "text",
      options: useBadmintonClubDropdown ? badmintonClubOptions : undefined,
      allowFreeText: useBadmintonClubDropdown,
      width: 30,
      note: useBadmintonClubDropdown ? "Choose from master club list or type a custom club/school/team name." : undefined,
    },
  ];

  if (fields.enableSbaId) {
    columns.push({ label: "SBA ID", required: fields.requireSbaId, type: "text", width: 16 });
  }

  if (fields.enableTshirt) {
    columns.push({ label: "T-Shirt Size", required: fields.requireTshirt, type: "select", options: TSHIRT_SIZES, width: 14 });
  }

  if (fields.enableGuardianInfo) {
    columns.push(
      { label: "Guardian Name", required: fields.requireGuardianInfo, type: "text", width: 24 },
      { label: "Guardian Contact Number", required: fields.requireGuardianInfo, type: "text", width: 22 },
    );
  }

  for (const [index, cf] of fields.customFields.entries()) {
    const fieldType = cf.type === "select" || cf.type === "date" || cf.type === "number" ? cf.type : "text";
    columns.push({
      label: cf.label || `Custom Field ${index + 1}`,
      required: cf.required,
      type: fieldType,
      options: fieldType === "select" ? splitOptions(cf.options) : undefined,
      width: fieldType === "date" ? 16 : 24,
      note: customFieldKey(cf, index),
    });
  }

  if (fields.enableRemark) {
    columns.push({ label: "Remark", required: fields.requireRemark, type: "text", width: 32 });
  }

  return columns;
}

function validationXml(rules: ValidationRule[]) {
  const entries = rules.flatMap(rule => {
    const column = columnLetter(rule.columnIndex);
    const sqref = `${column}${FIRST_DATA_ROW_NUMBER}:${column}${LAST_DATA_ROW_NUMBER}`;

    if (rule.type === "select" && rule.options?.length) {
      const formula = rule.definedName ?? `"${rule.options.join(",")}"`;
      const showErrorMessage = rule.allowFreeText ? "0" : "1";
      return `<dataValidation type="list" allowBlank="1" showDropDown="0" showErrorMessage="${showErrorMessage}" sqref="${sqref}"><formula1>${xmlEscape(formula)}</formula1></dataValidation>`;
    }

    return [];
  });

  if (!entries.length) return "";
  return `<dataValidations count="${entries.length}">${entries.join("")}</dataValidations>`;
}

function workbookDefinedNamesXml(optionRanges: OptionRange[]) {
  if (!optionRanges.length) return "";
  const definitions = optionRanges
    .filter(range => range.optionCount > 0)
    .map(range => {
      const column = columnLetter(range.columnIndex);
      return `<definedName name="${xmlEscape(range.definedName)}">'${xmlEscape(OPTIONS_SHEET)}'!$${column}$2:$${column}$${range.optionCount + 1}</definedName>`;
    });

  return `<definedNames>${definitions.join("")}</definedNames>`;
}

function dataValidationFeature(rules: ValidationRule[], optionRanges: OptionRange[]): Feature<Blob> {
  return {
    files: {
      transform: {
        "xl/workbook.xml": {
          transform(xml) {
            const definedNames = workbookDefinedNamesXml(optionRanges);
            if (!definedNames) return xml;
            return xml.replace("<definedNames/>", definedNames);
          },
        },
        "xl/worksheets/sheet{id}.xml": {
          transform(xml, _sheetOptions, properties) {
            if (properties.sheetIndex !== 0) return xml;
            const xmlToInsert = validationXml(rules);
            if (!xmlToInsert) return xml;
            if (xml.includes("<dataValidations")) return xml;
            return xml.replace("</worksheet>", `${xmlToInsert}</worksheet>`);
          },
        },
      },
    },
  };
}

function headerCell(value: string) {
  return {
    value,
    fontWeight: "bold" as const,
    backgroundColor: "#2f3f50",
    textColor: "#ffffff",
    alignVertical: "center" as const,
    height: 26,
  };
}

function buildEntrySheet(event: TournamentEvent, program: Program, columns: TemplateColumn[]): SheetData {
  const headerRow = columns.map(column => headerCell(requiredLabel(column)));
  const exampleRow = columns.map(column => {
    if (column.label === ROW_TYPE_COLUMN) return SAMPLE_ROW_TYPE;
    if (column.label === "Entry No") return { value: 1, type: Number, align: "right" as const };
    if (column.label === "Full Name") return "Sample Player";
    if (column.label === "Gender") return genderOptions(program)[0] ?? "Male";
    if (column.label === "Email") return "sample@example.com";
    if (column.label === "Contact Number") return "0123456789";
    if (column.label === "Nationality") return "MY - Malaysia";
    if (column.label === "Club / Team / School") return isBadmintonTemplate(event, program) ? CLUB_NO_CLUB_VALUE : "Sample Club";
    if (column.label === "Player No") return { value: 1, type: Number, align: "right" as const };
    if (column.label === "Date of Birth" || column.type === "date") {
      return { value: new Date(2000, 0, 1), type: Date, format: "yyyy-mm-dd" };
    }
    return "";
  });
  const blankRows = Array.from({ length: TEMPLATE_ROW_COUNT - 1 }, () =>
    columns.map(column => {
      if (column.type === "date") return { value: undefined, type: Date, format: "yyyy-mm-dd" };
      if (column.type === "number") return { value: undefined, type: Number };
      return "";
    }),
  );

  return [
    [{ value: "TRS Participant Import Template", fontWeight: "bold", fontSize: 16 }, null, null, null],
    [`Event: ${event.name}`, null, `Event ID: ${event.id}`, null],
    [`Program: ${program.name}`, null, `Program ID: ${program.id}`, null],
    [`Players per entry: ${program.minPlayers}-${program.maxPlayers}`, null, `Fee structure: ${program.feeStructure}`, null],
    headerRow,
    exampleRow,
    ...blankRows,
  ];
}

function buildInfoSheet(event: TournamentEvent, program: Program, columns: TemplateColumn[]): SheetData {
  const customColumns = columns.filter(column => column.note?.startsWith("Custom:"));
  const optionalDocumentNote = program.fields.enableDocumentUpload
    ? "Document upload is configured for this program but is intentionally excluded from the Excel template. Upload/import validation can handle documents separately later."
    : "No document upload field is configured for this program.";

  return [
    [{ value: "Template Scope", fontWeight: "bold", fontSize: 14 }],
    ["Event ID", event.id],
    ["Event Name", event.name],
    ["Program ID", program.id],
    ["Program Name", program.name],
    ["Program Type", program.type],
    ["Program Gender", program.gender],
    ["Min Players Per Entry", program.minPlayers],
    ["Max Players Per Entry", program.maxPlayers],
    ["Fee Structure", program.feeStructure],
    [],
    [{ value: "Import Notes", fontWeight: "bold", fontSize: 14 }],
    ["Rows", `Fill participants from row ${FIRST_DATA_ROW_NUMBER} onward on "${ENTRY_SHEET}".`],
    ["Sample Rows", `Rows marked ${SAMPLE_ROW_TYPE} in "${ROW_TYPE_COLUMN}" are ignored during import. Delete them or overwrite Row Type with DATA/blank before entering real participants.`],
    ["Entry No", "This groups players into one entry/team. For singles, each participant can use a different Entry No. For doubles/team, use the same Entry No for all players in that entry."],
    ["Dates", "Use yyyy-mm-dd format."],
    ["Dropdowns", `Dropdown values are stored in "${OPTIONS_SHEET}".`],
    ...(isBadmintonTemplate(event, program) ? [["Badminton Club", "Club / Team / School is sourced from the badminton club master table, but custom text is allowed for clubs not in the list."]] : []),
    ["Document Upload", optionalDocumentNote],
    ["Future Import Check", "Import should verify Event ID and Program ID from this sheet before accepting rows."],
    [],
    [{ value: "Custom Field Mapping", fontWeight: "bold", fontSize: 14 }],
    ["Column Label", "Field Key"],
    ...customColumns.map(column => [column.label, column.note ?? ""]),
  ];
}

function buildOptionsSheet(columns: TemplateColumn[]): SheetData {
  const optionColumns = columns.filter(column => column.type === "select" && column.options?.length);
  const maxOptions = Math.max(0, ...optionColumns.map(column => column.options?.length ?? 0));
  const rows: SheetData = [
    optionColumns.map(column => headerCell(column.label)),
  ];

  for (let rowIndex = 0; rowIndex < maxOptions; rowIndex += 1) {
    rows.push(optionColumns.map(column => column.options?.[rowIndex] ?? ""));
  }

  return rows;
}

export async function exportProgramImportTemplate(event: TournamentEvent, program: Program) {
  const writeExcelFile = (await import("write-excel-file/browser")).default;
  let badmintonClubOptions: string[] = [];
  if (isBadmintonTemplate(event, program)) {
    const clubResult = await apiGetBadmintonClubs();
    if (clubResult.error) {
      throw new Error(clubResult.error.message);
    }
    badmintonClubOptions = [
      CLUB_NO_CLUB_VALUE,
      ...(clubResult.data ?? []).map(club => club.name).filter(Boolean),
    ];
  }

  const columns = buildColumns(event, program, badmintonClubOptions);
  const optionColumns = columns.filter(column => column.type === "select" && column.options?.length);
  const optionRanges: OptionRange[] = optionColumns.map((column, columnIndex) => ({
    label: column.label,
    definedName: definedNameForColumn(column.label, columnIndex),
    columnIndex,
    optionCount: column.options?.length ?? 0,
  }));
  const validationRules: ValidationRule[] = columns
    .map((column, columnIndex) => {
      const optionColumnIndex = optionColumns.indexOf(column);
      const definedName = optionColumnIndex >= 0 && column.options?.length
        ? optionRanges[optionColumnIndex]?.definedName
        : undefined;
      return { ...column, columnIndex, definedName };
    })
    .filter(column => column.type === "select");

  await writeExcelFile(
    [
      {
        sheet: ENTRY_SHEET,
        data: buildEntrySheet(event, program, columns),
        columns: columns.map(column => ({ width: column.width })),
        stickyRowsCount: HEADER_ROW_NUMBER,
        dateFormat: "yyyy-mm-dd",
      },
      {
        sheet: INFO_SHEET,
        data: buildInfoSheet(event, program, columns),
        columns: [{ width: 24 }, { width: 90 }],
      },
      {
        sheet: OPTIONS_SHEET,
        data: buildOptionsSheet(columns),
        columns: optionColumns.map(() => ({ width: 28 })),
      },
    ],
    { features: [dataValidationFeature(validationRules, optionRanges)] },
  ).toFile(`${safeFilename(`${event.name} - ${program.name} - Import Template`)}.xlsx`);
}
