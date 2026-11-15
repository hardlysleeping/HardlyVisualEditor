/**
 * Remove control for inline composer chips.
 * Location: packages/sdk/src/overlay/ChipRemoveButton.tsx
 */

type Props = {
  /** Spoken label: chips remove different things (an element, a screenshot). */
  label: string;
  onRemove: () => void | Promise<void>;
};

export function ChipRemoveButton({ label, onRemove }: Props) {
  return (
    <button
      type="button"
      aria-label={label}
      data-ve-chip-remove="true"
      data-visual-editor-ui="true"
      className="ve-chip-remove"
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void onRemove();
      }}
    >
      ×
    </button>
  );
}
