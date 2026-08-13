type SwitchProps = {
  checked: boolean;
  onChange: () => void;
  "aria-label": string;
};

export function Switch({ checked, onChange, "aria-label": ariaLabel }: SwitchProps) {
  return (
    <button type="button" className={`ui-switch${checked ? " is-checked" : ""}`} role="switch"
      aria-checked={checked} aria-label={ariaLabel} onClick={onChange}>
      <span className="ui-switch-track"><span className="ui-switch-thumb" /></span>
    </button>
  );
}
