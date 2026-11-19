import { DropdownItem, PanelSectionRow, SliderField, ToggleField } from "decky-frontend-lib";
import { useState, VFC } from "react";
import * as python from "../python";
import { useCssLoaderState } from "../state";
import { Patch } from "../ThemeTypes";
import { PatchComponent } from "./PatchComponent";

export const ThemePatch: VFC<{
  data: Patch;
  index: number;
  fullArr: Patch[];
  themeName: string;
  modal?: boolean;
}> = ({ data, index, fullArr, themeName, modal = false }) => {
  const { selectedPreset } = useCssLoaderState();
  const [selectedIndex, setIndex] = useState(data.options.indexOf(data.value));

  const [selectedLabel, setLabel] = useState(data.value);

  const bottomSeparatorValue = fullArr.length - 1 === index ? "standard" : "none";

  async function setPatchValue(value: string) {
    await python.setPatchOfTheme(themeName, data.name, value);
    // This was before all currently toggled themes were part of a dependency, this (and probably lots of the other preset code) can be changed to assume that by default
    if (selectedPreset && selectedPreset.dependencies.includes(themeName)) {
      return python.generatePresetFromThemeNames(selectedPreset.name, selectedPreset.dependencies);
    }
    return;
  }

  function ComponentWrapper() {
    return (
      <>
        {data.components.length > 0 ? (
          <>
            {data.components.map((e) => (
              <PatchComponent
                data={e}
                selectedLabel={selectedLabel}
                themeName={themeName}
                patchName={data.name}
                bottomSeparatorValue={bottomSeparatorValue}
              />
            ))}
          </>
        ) : null}
      </>
    );
  }

  switch (data.type) {
    case "slider": {
      // Millennium: in Quick Access, labels that don't fit between their notches
      // run together or past the panel. Those sliders label only their ends
      // and show the current value next to the name.
      const crowded = notchLabelsCrowded(data.options);
      const last = data.options.length - 1;
      return (
        <>
          <PanelSectionRow>
            <SliderField
              bottomSeparator={bottomSeparatorValue}
              label={
                crowded ? (
                  <ValueLabel name={data.name} value={selectedLabel} modal={modal} />
                ) : modal ? (
                  data.name
                ) : (
                  <PatchLabel name={data.name} />
                )
              }
              min={0}
              max={last}
              value={selectedIndex}
              onChange={(value) => {
                setPatchValue(data.options[value]);
                setIndex(value);
                setLabel(data.options[value]);
                data.value = data.options[value];
              }}
              notchCount={crowded ? 2 : data.options.length}
              notchLabels={
                crowded
                  ? [
                      { notchIndex: 0, label: data.options[0], value: 0 },
                      { notchIndex: 1, label: data.options[last], value: last },
                    ]
                  : data.options.map((e, i) => ({
                      notchIndex: i,
                      label: e,
                      value: i,
                    }))
              }
            />
          </PanelSectionRow>
          <ComponentWrapper />
        </>
      );
    }
    case "checkbox":
      return (
        <>
          <PanelSectionRow>
            <ToggleField
              bottomSeparator={bottomSeparatorValue}
              label={modal ? data.name : <PatchLabel name={data.name} />}
              checked={data.value === "Yes"}
              onChange={(bool) => {
                const newValue = bool ? "Yes" : "No";
                setPatchValue(newValue);
                setLabel(newValue);
                setIndex(data.options.findIndex((e) => e === newValue));
                data.value = newValue;
              }}
            />
          </PanelSectionRow>
          <ComponentWrapper />
        </>
      );
    case "dropdown":
      return (
        <>
          <PanelSectionRow>
            <DropdownItem
              layout="below"
              bottomSeparator={bottomSeparatorValue}
              label={modal ? data.name : <PatchLabel name={data.name} />}
              menuLabel={`${data.name}`}
              rgOptions={data.options.map((x, i) => {
                return { data: i, label: x };
              })}
              selectedOption={selectedIndex}
              onChange={(index) => {
                setIndex(index.data);
                data.value = index.label as string;
                setLabel(data.value);
                setPatchValue(data.value);
              }}
            />
          </PanelSectionRow>
          <ComponentWrapper />
        </>
      );
    case "none":
      return (
        <>
          <PanelSectionRow>
            {modal ? (
              <span style={{ color: "#dcdedf" }}>{data.name}</span>
            ) : (
              <PatchLabel name={data.name} />
            )}
          </PanelSectionRow>
          <ComponentWrapper />
        </>
      );
    default:
      return null;
  }
};

// Millennium: see the slider case. Measured in Quick Access, the narrowest
// place a patch is shown: a 250 px track, notches at least 24 px wide, labels
// in 10 px Motiva Sans.
const SLIDER_TRACK_PX = 250;
const MIN_NOTCH_PX = 24;
const LABEL_GAP_PX = 2;

function labelWidth(label: string) {
  let width = 0;
  for (const char of label) {
    if (/[0-9]/.test(char)) width += 6.8;
    else if (char === "%") width += 9.5;
    else if (char === "." || char === "," || char === " ") width += 3.5;
    else if (/[A-Z]/.test(char)) width += 8;
    else width += 6.5;
  }
  return width;
}

function notchLabelsCrowded(options: string[]) {
  if (options.length < 2) return false;
  if (options.length * MIN_NOTCH_PX > SLIDER_TRACK_PX + MIN_NOTCH_PX) return true;
  const spacing = SLIDER_TRACK_PX / (options.length - 1);
  for (let i = 1; i < options.length; i++) {
    if ((labelWidth(options[i - 1]) + labelWidth(options[i])) / 2 + LABEL_GAP_PX > spacing) return true;
  }
  return false;
}

const ValueLabel = ({ name, value, modal }: { name: string; value: string; modal: boolean }) => {
  return (
    <div
      className={modal ? undefined : "DialogLabel"}
      style={{ marginBottom: "0px", display: "flex", justifyContent: "space-between", gap: "8px" }}
    >
      <span>{name}</span>
      <span style={{ opacity: 0.7, whiteSpace: "nowrap" }}>{value}</span>
    </div>
  );
};

const PatchLabel = ({ name }: { name: string }) => {
  return (
    <div
      className="DialogLabel"
      style={{
        marginBottom: "0px",
      }}
    >
      {name}
    </div>
  );
};
