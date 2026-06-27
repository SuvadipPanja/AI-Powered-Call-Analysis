import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FaSearch, FaCheck, FaUserCircle } from "react-icons/fa";
import { UserAvatar } from "./ui";

export default function UploadAgentPicker({
  agents,
  value,
  typedValue,
  onTypedChange,
  onSelect,
  disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const [menuStyle, setMenuStyle] = useState(null);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const listboxId = useId();

  const filtered = (() => {
    if (!typedValue.trim()) return agents;
    const q = typedValue.toLowerCase();
    return agents.filter(
      (a) =>
        a.agent_name?.toLowerCase().includes(q) ||
        a.agent_id?.toString().toLowerCase().includes(q)
    );
  })();

  const visible = filtered.slice(0, 40);

  const updatePosition = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const gap = 6;
    const maxH = 240;
    const spaceBelow = window.innerHeight - rect.bottom - gap;
    const openUp = spaceBelow < 160 && rect.top > spaceBelow;
    const height = Math.min(maxH, openUp ? rect.top - gap - 8 : spaceBelow - 8);

    setMenuStyle({
      position: "fixed",
      left: rect.left,
      width: rect.width,
      top: openUp ? rect.top - gap - height : rect.bottom + gap,
      maxHeight: Math.max(100, height),
      zIndex: 9999,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    const sync = () => updatePosition();
    window.addEventListener("scroll", sync, true);
    window.addEventListener("resize", sync);
    return () => {
      window.removeEventListener("scroll", sync, true);
      window.removeEventListener("resize", sync);
    };
  }, [open, updatePosition, typedValue, visible.length]);

  useEffect(() => setHighlightIdx(0), [typedValue]);

  useEffect(() => {
    const onClick = (e) => {
      if (wrapRef.current?.contains(e.target) || listRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const pick = (item) => {
    onSelect(item);
    setOpen(false);
  };

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlightIdx((i) => Math.min(i + 1, visible.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (visible[highlightIdx]) pick(visible[highlightIdx]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const menu = open && menuStyle && (
    <div ref={listRef} id={listboxId} className="upload-agent-menu" style={menuStyle} role="listbox">
      <div className="upload-agent-menu__scroll">
        {visible.length > 0 ? (
          visible.map((item, idx) => {
            const selected = value === item.agent_name;
            return (
              <button
                key={`${item.agent_id || item.agent_name}-${idx}`}
                type="button"
                className={[
                  "upload-agent-option",
                  selected ? "upload-agent-option--selected" : "",
                  idx === highlightIdx ? "upload-agent-option--highlight" : "",
                ].filter(Boolean).join(" ")}
                onMouseEnter={() => setHighlightIdx(idx)}
                onClick={() => pick(item)}
                role="option"
                aria-selected={selected}
              >
                <span className="upload-agent-option__avatar">
                  <UserAvatar username={item.agent_name} size="sm" alt="" />
                </span>
                <span className="upload-agent-option__body">
                  <span className="upload-agent-option__name">{item.agent_name}</span>
                  {item.agent_id && <span className="upload-agent-option__id">{item.agent_id}</span>}
                </span>
                {selected && <FaCheck className="upload-agent-option__check" aria-hidden="true" />}
              </button>
            );
          })
        ) : (
          <div className="upload-agent-menu__empty">
            <FaUserCircle />
            <p>No agents found</p>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="upload-field upload-agent-picker" ref={wrapRef}>
      <span className="upload-field__label">Agent</span>

      {value && !open && typedValue === value ? (
        <div className="upload-agent-chip">
          <span className="upload-agent-chip__avatar">
            <UserAvatar username={value} size="sm" alt="" />
          </span>
          <span className="upload-agent-chip__name">{value}</span>
          <button
            type="button"
            className="upload-agent-chip__change"
            disabled={disabled}
            onClick={() => {
              onSelect(null);
              onTypedChange("");
              setOpen(true);
              setTimeout(() => inputRef.current?.focus(), 0);
            }}
          >
            Change
          </button>
        </div>
      ) : (
        <div className={`upload-agent-input-wrap ${open ? "upload-agent-input-wrap--open" : ""}`}>
          <FaSearch className="upload-agent-input-wrap__icon" aria-hidden="true" />
          <input
            ref={inputRef}
            id="agent-select"
            type="text"
            role="combobox"
            className="ui-input upload-agent-input"
            placeholder="Search agent name or ID"
            value={typedValue}
            onChange={(e) => { onTypedChange(e.target.value); setOpen(true); }}
            onFocus={() => !disabled && setOpen(true)}
            onKeyDown={onKeyDown}
            aria-required="true"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-autocomplete="list"
            autoComplete="off"
            disabled={disabled}
          />
        </div>
      )}

      {typeof document !== "undefined" && menu && createPortal(menu, document.body)}
    </div>
  );
}
