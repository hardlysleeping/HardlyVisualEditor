//! Shared transaction types and history for manual and agent-driven UI edits.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Stable target identity, ordered from the preferred upstream metadata to a
/// generated fallback. At least one identity field must be populated.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ElementIdentity {
    pub webview_id: String,
    pub inspector_id: Option<String>,
    pub html_id: Option<String>,
    pub semantic_selector: Option<String>,
    pub generated_id: Option<String>,
}

impl ElementIdentity {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.webview_id.trim().is_empty() || self.webview_id.chars().any(char::is_control) {
            return Err("webview_id must not be empty");
        }
        let has_selector = [
            self.inspector_id.as_deref(),
            self.html_id.as_deref(),
            self.semantic_selector.as_deref(),
            self.generated_id.as_deref(),
        ]
        .into_iter()
        .flatten()
        .any(|value| !value.trim().is_empty());
        if !has_selector {
            return Err("element identity must contain at least one selector");
        }
        if self.generated_id.as_deref().is_some_and(|value| {
            value.is_empty()
                || value.len() > 128
                || !value
                    .bytes()
                    .all(|ch| ch.is_ascii_alphanumeric() || ch == b'_' || ch == b'-')
        }) {
            return Err("generated element IDs must use letters, numbers, _ or -");
        }
        Ok(())
    }

    /// Return the most stable available identity in the documented order.
    pub fn preferred_selector(&self) -> Option<(&'static str, &str)> {
        self.inspector_id
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .map(|value| ("data-inspector-id", value))
            .or_else(|| {
                self.html_id
                    .as_deref()
                    .filter(|value| !value.trim().is_empty())
                    .map(|value| ("id", value))
            })
            .or_else(|| {
                self.semantic_selector
                    .as_deref()
                    .filter(|value| !value.trim().is_empty())
                    .map(|value| ("semantic_selector", value))
            })
            .or_else(|| {
                self.generated_id
                    .as_deref()
                    .filter(|value| !value.trim().is_empty())
                    .map(|value| ("generated_id", value))
            })
    }

    /// Stable attributes are preferred; the generated semantic selector is the
    /// framework-neutral MVP fallback when the app has no explicit identity.
    pub fn stable_css_selector(&self) -> Option<(&'static str, &str)> {
        self.inspector_id
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .map(|value| ("data-inspector-id", value))
            .or_else(|| {
                self.html_id
                    .as_deref()
                    .filter(|value| !value.trim().is_empty())
                    .map(|value| ("id", value))
            })
            .or_else(|| {
                self.generated_id
                    .as_deref()
                    .filter(|value| !value.trim().is_empty())
                    .map(|value| ("data-hardlyui-id", value))
            })
            .or_else(|| {
                self.semantic_selector
                    .as_deref()
                    .filter(|value| !value.trim().is_empty())
                    .map(|value| ("semantic_selector", value))
            })
    }
}

/// Reversible changes to the host DOM. Structural operations are stored in the
/// same project history as style edits and replayed by the plugin after load.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "operation", rename_all = "snake_case")]
pub enum StyleOperation {
    SetStyle {
        identity: ElementIdentity,
        property: String,
        before: Option<String>,
        after: Option<String>,
    },
    SetResponsiveStyle {
        identity: ElementIdentity,
        property: String,
        breakpoint: String,
        before: Option<String>,
        after: Option<String>,
    },
    SetText {
        identity: ElementIdentity,
        before: String,
        after: String,
        /// Which of the element's own text nodes to change. Defaults to the
        /// first, so histories written before this field existed still load.
        #[serde(default)]
        text_index: usize,
    },
    SetAttribute {
        identity: ElementIdentity,
        name: String,
        before: Option<String>,
        after: Option<String>,
    },
    SetTextBinding {
        identity: ElementIdentity,
        before: Option<ElementIdentity>,
        after: Option<ElementIdentity>,
        before_text: String,
    },
    InsertElement {
        identity: ElementIdentity,
        parent: ElementIdentity,
        tag: String,
        text: String,
        #[serde(default)]
        class_names: Vec<String>,
        #[serde(default)]
        slot_name: Option<String>,
        #[serde(default)]
        image_url: Option<String>,
    },
    RemoveElement {
        identity: ElementIdentity,
        parent: ElementIdentity,
        position: u32,
        outer_html: String,
    },
    MoveElement {
        identity: ElementIdentity,
        before_parent: ElementIdentity,
        before_position: u32,
        after_parent: ElementIdentity,
        after_position: u32,
    },
}

/// One committed user or agent action. A group of property changes can share
/// one transaction so a drag gesture undoes as a single step.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Transaction {
    pub id: String,
    pub label: Option<String>,
    pub operations: Vec<StyleOperation>,
}

impl Transaction {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.id.trim().is_empty() {
            return Err("transaction id must not be empty");
        }
        if self.operations.is_empty() {
            return Err("transaction must contain at least one operation");
        }
        for operation in &self.operations {
            validate_style_operation(operation)?;
            match operation {
                StyleOperation::SetStyle { before, after, .. } if before == after => {
                    return Err("style operation must change the value");
                }
                _ => {}
            }
        }
        Ok(())
    }
}

pub fn validate_style_operation(operation: &StyleOperation) -> Result<(), &'static str> {
    match operation {
        StyleOperation::SetStyle {
            identity,
            property,
            before,
            after,
        } => {
            identity.validate()?;
            validate_persistable_identity(identity)?;
            if !supported_property(property) {
                return Err("unsupported CSS property");
            }
            for value in before.iter().chain(after.iter()) {
                if value.len() > 256
                    || value.chars().any(|ch| matches!(ch, '{' | '}' | ';'))
                    || value.chars().any(char::is_control)
                {
                    return Err("invalid CSS value");
                }
                if property == "width" {
                    validate_width_value(value)?;
                }
            }
        }
        StyleOperation::SetResponsiveStyle {
            identity,
            property,
            breakpoint,
            before,
            after,
        } => {
            identity.validate()?;
            validate_persistable_identity(identity)?;
            if !supported_property(property)
                || !matches!(breakpoint.as_str(), "phone" | "tablet" | "desktop")
            {
                return Err("unsupported responsive style or breakpoint");
            }
            for value in before.iter().chain(after.iter()) {
                if value.len() > 256
                    || value
                        .chars()
                        .any(|ch| matches!(ch, '{' | '}' | ';') || ch.is_control())
                {
                    return Err("invalid responsive CSS value");
                }
                if property == "width" {
                    validate_width_value(value)?;
                }
            }
            if before == after {
                return Err("responsive style operation must change the value");
            }
        }
        StyleOperation::SetText {
            identity,
            before,
            after,
            text_index,
        } => {
            identity.validate()?;
            if *text_index > 64 {
                return Err("text index is out of range");
            }
            validate_persistable_identity(identity)?;
            for value in [before, after] {
                if value.len() > 5_000
                    || value
                        .chars()
                        .any(|ch| ch.is_control() && !matches!(ch, '\n' | '\r' | '\t'))
                {
                    return Err("invalid edited text");
                }
            }
            if before == after {
                return Err("text operation must change the value");
            }
        }
        StyleOperation::SetAttribute {
            identity,
            name,
            before,
            after,
        } => {
            identity.validate()?;
            validate_persistable_identity(identity)?;
            if name != "data-hardlyui-name" || before == after {
                return Err("unsupported or unchanged element attribute");
            }
            if before
                .iter()
                .chain(after.iter())
                .any(|value| value.len() > 80 || value.chars().any(char::is_control))
            {
                return Err("invalid structure name");
            }
        }
        StyleOperation::SetTextBinding {
            identity,
            before,
            after,
            before_text,
        } => {
            identity.validate()?;
            validate_persistable_identity(identity)?;
            if before == after {
                return Err("text binding operation must change its source");
            }
            if before_text.len() > 5_000
                || before_text
                    .chars()
                    .any(|ch| ch.is_control() && !matches!(ch, '\n' | '\r' | '\t'))
            {
                return Err("invalid text binding fallback");
            }
            for source in before.iter().chain(after.iter()) {
                source.validate()?;
                validate_persistable_identity(source)?;
                if source.webview_id != identity.webview_id {
                    return Err("text binding source and target must be in the same webview");
                }
            }
        }
        StyleOperation::InsertElement {
            identity,
            parent,
            tag,
            text,
            class_names,
            slot_name,
            image_url,
        } => {
            identity.validate()?;
            parent.validate()?;
            if identity.webview_id != parent.webview_id {
                return Err("edit target and parent must be in the same webview");
            }
            validate_persistable_identity(identity)?;
            validate_persistable_identity(parent)?;
            if !matches!(tag.as_str(), "div" | "p" | "span" | "button" | "img") {
                return Err("unsupported inserted element type");
            }
            if tag == "img" && image_url.is_none() {
                return Err("image elements need an artwork URL");
            }
            if image_url.as_deref().is_some_and(|url| {
                url.is_empty()
                    || url.len() > 2_048
                    || url.chars().any(|ch| {
                        ch.is_whitespace()
                            || ch.is_control()
                            || matches!(ch, '"' | '\'' | '<' | '>')
                    })
                    || !(url.starts_with("https://")
                        || url.starts_with("asset://")
                        || url.starts_with("tauri://")
                        || url.starts_with("http://localhost/")
                        || url.starts_with("http://tauri.localhost/")
                        || (!url.starts_with("//")
                            && !url.contains(':')
                            && !url.split('/').any(|segment| segment == "..")))
            }) {
                return Err("artwork must use a secure URL or local app path");
            }
            if text.len() > 5_000 || text.chars().any(char::is_control) {
                return Err("invalid inserted text");
            }
            if class_names.len() > 32
                || class_names.iter().any(|name| {
                    name.is_empty()
                        || name.len() > 128
                        || !name.chars().all(|ch| {
                            ch.is_ascii_alphanumeric()
                                || matches!(ch, '_' | '-' | ':' | '/' | '[' | ']' | '.' | '#' | '%')
                        })
                })
            {
                return Err("invalid inserted class name");
            }
            if slot_name.as_deref().is_some_and(|name| {
                name.is_empty()
                    || name.len() > 32
                    || !name
                        .bytes()
                        .all(|ch| ch.is_ascii_alphanumeric() || ch == b'_' || ch == b'-')
                    || name
                        .as_bytes()
                        .first()
                        .is_some_and(|ch| !ch.is_ascii_alphabetic())
            }) {
                return Err("invalid component slot name");
            }
        }
        StyleOperation::RemoveElement {
            identity,
            parent,
            position: _,
            outer_html,
        } => {
            identity.validate()?;
            parent.validate()?;
            if identity.webview_id != parent.webview_id {
                return Err("edit target and parent must be in the same webview");
            }
            validate_persistable_identity(identity)?;
            validate_persistable_identity(parent)?;
            if outer_html.is_empty() || outer_html.len() > 100_000 || outer_html.contains("<script")
            {
                return Err("invalid removable element snapshot");
            }
        }
        StyleOperation::MoveElement {
            identity,
            before_parent,
            after_parent,
            before_position,
            after_position,
        } => {
            identity.validate()?;
            before_parent.validate()?;
            after_parent.validate()?;
            validate_persistable_identity(identity)?;
            validate_persistable_identity(before_parent)?;
            validate_persistable_identity(after_parent)?;
            if identity.webview_id != before_parent.webview_id
                || identity.webview_id != after_parent.webview_id
            {
                return Err("moved element and containers must be in the same webview");
            }
            if before_parent == after_parent && before_position == after_position {
                return Err("move operation must change the element position");
            }
        }
    }
    Ok(())
}

fn supported_property(property: &str) -> bool {
    matches!(
        property,
        "width"
            | "height"
            | "min-width"
            | "max-width"
            | "min-height"
            | "max-height"
            | "margin"
            | "margin-top"
            | "margin-right"
            | "margin-bottom"
            | "margin-left"
            | "padding"
            | "padding-top"
            | "padding-right"
            | "padding-bottom"
            | "padding-left"
            | "color"
            | "background-color"
            | "display"
            | "flex-direction"
            | "flex-wrap"
            | "flex-grow"
            | "flex-shrink"
            | "flex-basis"
            | "grid-template-columns"
            | "order"
            | "align-items"
            | "align-self"
            | "justify-content"
            | "gap"
            | "font-size"
            | "font-weight"
            | "line-height"
            | "border-radius"
            | "border-width"
            | "border-color"
            | "translate"
            | "--hardlyui-locked"
    )
}

fn validate_selector(selector: &str) -> Result<(), &'static str> {
    if selector.trim().is_empty()
        || selector.len() > 2_048
        || selector.chars().any(char::is_control)
        || selector.chars().any(|ch| matches!(ch, '{' | '}' | ';'))
    {
        return Err("invalid semantic selector");
    }
    Ok(())
}

fn validate_persistable_identity(identity: &ElementIdentity) -> Result<(), &'static str> {
    if let Some((attribute, value)) = identity.stable_css_selector() {
        if attribute == "semantic_selector" {
            validate_selector(value)?;
        }
        Ok(())
    } else if let Some(selector) = identity
        .semantic_selector
        .as_deref()
        .filter(|s| !s.trim().is_empty())
    {
        validate_selector(selector)
    } else {
        Err("element needs an id or semantic selector to persist edits")
    }
}

/// In-memory cursor over committed edits. Persistence and DOM application are
/// deliberately handled by the plugin layer; this type only decides which
/// transaction to apply or reverse.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct EditHistory {
    transactions: Vec<Transaction>,
    cursor: usize,
}

impl EditHistory {
    pub fn transactions(&self) -> &[Transaction] {
        &self.transactions
    }

    pub fn cursor(&self) -> usize {
        self.cursor
    }

    /// Active operations in replay order for a host webview.
    pub fn active_operations_for(&self, webview_id: &str) -> Vec<&StyleOperation> {
        self.active_transactions()
            .iter()
            .flat_map(|transaction| transaction.operations.iter())
            .filter(|operation| match operation {
                StyleOperation::SetStyle { identity, .. }
                | StyleOperation::SetResponsiveStyle { identity, .. }
                | StyleOperation::SetText { identity, .. }
                | StyleOperation::SetAttribute { identity, .. }
                | StyleOperation::SetTextBinding { identity, .. }
                | StyleOperation::InsertElement { identity, .. }
                | StyleOperation::RemoveElement { identity, .. }
                | StyleOperation::MoveElement { identity, .. } => identity.webview_id == webview_id,
            })
            .collect()
    }

    fn active_transactions(&self) -> &[Transaction] {
        &self.transactions[..self.cursor]
    }

    pub fn validate(&self) -> Result<(), &'static str> {
        if self.cursor > self.transactions.len() {
            return Err("edit history cursor is out of range");
        }
        for transaction in &self.transactions {
            transaction.validate()?;
        }
        self.overrides_css()?;
        Ok(())
    }

    /// Build deterministic CSS for the current history cursor. Repeated edits
    /// to one property collapse to the latest value; an unset value removes
    /// that declaration.
    pub fn overrides_css(&self) -> Result<String, &'static str> {
        if self.cursor > self.transactions.len() {
            return Err("edit history cursor is out of range");
        }
        let mut rules: BTreeMap<String, BTreeMap<String, String>> = BTreeMap::new();
        let mut responsive_rules: BTreeMap<String, BTreeMap<String, String>> = BTreeMap::new();
        for transaction in self.active_transactions() {
            for operation in &transaction.operations {
                match operation {
                    StyleOperation::SetStyle {
                        identity,
                        property,
                        after,
                        ..
                    } => {
                        if !supported_property(property) {
                            return Err("unsupported CSS property in edit history");
                        }
                        let (attribute, value) = identity
                            .stable_css_selector()
                            .ok_or("element needs an id or semantic selector before saving")?;
                        let selector = if attribute == "semantic_selector" {
                            validate_selector(value)?;
                            value.to_string()
                        } else {
                            format!("[{attribute}=\"{}\"]", escape_css_string(value))
                        };
                        let declarations = rules
                            .entry(format!("{}\0{selector}", identity.webview_id))
                            .or_default();
                        if let Some(value) = after {
                            if value.len() > 256
                                || value.chars().any(|ch| matches!(ch, '{' | '}' | ';'))
                            {
                                return Err("invalid CSS value");
                            }
                            declarations.insert(property.clone(), value.clone());
                        } else {
                            declarations.remove(property);
                        }
                    }
                    StyleOperation::InsertElement { .. }
                    | StyleOperation::RemoveElement { .. }
                    | StyleOperation::MoveElement { .. }
                    | StyleOperation::SetAttribute { .. }
                    | StyleOperation::SetTextBinding { .. } => {}
                    StyleOperation::SetText { .. } => {}
                    StyleOperation::SetResponsiveStyle {
                        identity,
                        property,
                        breakpoint,
                        after,
                        ..
                    } => {
                        if !supported_property(property)
                            || !matches!(breakpoint.as_str(), "phone" | "tablet" | "desktop")
                        {
                            return Err("unsupported responsive style in edit history");
                        }
                        let (attribute, value) = identity
                            .stable_css_selector()
                            .ok_or("responsive element needs a stable selector")?;
                        let selector = if attribute == "semantic_selector" {
                            validate_selector(value)?;
                            value.to_string()
                        } else {
                            format!("[{attribute}=\"{}\"]", escape_css_string(value))
                        };
                        let key = format!("{breakpoint}\0{}\0{selector}", identity.webview_id);
                        let declarations = responsive_rules.entry(key).or_default();
                        if let Some(value) = after {
                            if value.len() > 256
                                || value
                                    .chars()
                                    .any(|ch| matches!(ch, '{' | '}' | ';') || ch.is_control())
                            {
                                return Err("invalid responsive CSS value");
                            }
                            declarations.insert(property.clone(), value.clone());
                        } else {
                            declarations.remove(property);
                        }
                    }
                }
            }
        }

        let mut css =
            String::from("/* HardlyUI visual edits. Generated file; edit through HardlyUI. */\n");
        let mut owners: BTreeMap<String, (String, BTreeMap<String, String>)> = BTreeMap::new();
        let mut emitted: BTreeMap<String, BTreeMap<String, String>> = BTreeMap::new();
        for (key, declarations) in rules {
            let (webview_id, selector) = key
                .split_once('\0')
                .ok_or("invalid internal selector key")?;
            if let Some((owner, existing)) = owners.get(selector) {
                if owner != webview_id && existing != &declarations {
                    return Err("stable element IDs must be unique across edited webviews");
                }
            } else {
                owners.insert(
                    selector.to_string(),
                    (webview_id.to_string(), declarations.clone()),
                );
            }
            if !declarations.is_empty() {
                emitted.entry(selector.to_string()).or_insert(declarations);
            }
        }

        for (selector, declarations) in emitted {
            css.push_str(&selector);
            css.push_str(" {\n");
            for (property, value) in declarations {
                css.push_str("  ");
                css.push_str(&property);
                css.push_str(": ");
                css.push_str(&value);
                css.push_str(";\n");
            }
            css.push_str("}\n");
        }
        let mut responsive_emitted: BTreeMap<String, (String, BTreeMap<String, String>)> =
            BTreeMap::new();
        for (key, declarations) in responsive_rules {
            if declarations.is_empty() {
                continue;
            }
            let mut parts = key.splitn(3, '\0');
            let breakpoint = parts.next().ok_or("invalid responsive breakpoint key")?;
            let webview_id = parts.next().ok_or("invalid responsive webview key")?;
            let selector = parts.next().ok_or("invalid responsive selector key")?;
            let emitted_key = format!("{breakpoint}\0{selector}");
            if let Some((owner, existing)) = responsive_emitted.get(&emitted_key) {
                if owner != webview_id && existing != &declarations {
                    return Err("stable element IDs must be unique across edited webviews");
                }
                continue;
            }
            responsive_emitted.insert(emitted_key, (webview_id.to_string(), declarations.clone()));
            let media = match breakpoint {
                "phone" => "(max-width: 600px)",
                "tablet" => "(min-width: 601px) and (max-width: 1024px)",
                "desktop" => "(min-width: 1025px)",
                _ => return Err("invalid responsive breakpoint"),
            };
            css.push_str(&format!("@media {media} {{\n  {selector} {{\n"));
            for (property, value) in declarations {
                css.push_str(&format!("    {property}: {value} !important;\n"));
            }
            css.push_str("  }\n}\n");
        }
        Ok(css)
    }

    pub fn can_undo(&self) -> bool {
        self.cursor > 0
    }

    pub fn can_redo(&self) -> bool {
        self.cursor < self.transactions.len()
    }

    /// Commit a transaction, discarding the redo branch after an undo.
    pub fn commit(&mut self, transaction: Transaction) -> Result<(), &'static str> {
        transaction.validate()?;
        if self.cursor > 0 && self.transactions[self.cursor - 1].id == transaction.id {
            let index = self.cursor - 1;
            let mut current = self.transactions[index].clone();
            if current.operations.len() != transaction.operations.len() {
                return Err("a grouped transaction must keep the same operations");
            }
            for (old, new) in current
                .operations
                .iter_mut()
                .zip(transaction.operations.iter())
            {
                match (old, new) {
                    (
                        StyleOperation::SetStyle {
                            identity: old_identity,
                            property: old_property,
                            after: old_after,
                            ..
                        },
                        StyleOperation::SetStyle {
                            identity: new_identity,
                            property: new_property,
                            before: new_before,
                            after: new_after,
                        },
                    ) if old_identity == new_identity
                        && old_property == new_property
                        && old_after == new_before =>
                    {
                        *old_after = new_after.clone();
                    }
                    _ => return Err("a grouped transaction must continue its previous value"),
                }
            }
            if current.operations.iter().all(|operation| match operation {
                StyleOperation::SetStyle { before, after, .. } => before == after,
                StyleOperation::SetResponsiveStyle { before, after, .. } => before == after,
                StyleOperation::SetAttribute { before, after, .. } => before == after,
                StyleOperation::SetText { .. }
                | StyleOperation::SetTextBinding { .. }
                | StyleOperation::InsertElement { .. }
                | StyleOperation::RemoveElement { .. }
                | StyleOperation::MoveElement { .. } => false,
            }) {
                self.transactions.remove(index);
                self.cursor -= 1;
            } else {
                self.transactions[index] = current;
            }
            return Ok(());
        }
        self.transactions.truncate(self.cursor);
        self.transactions.push(transaction);
        self.cursor = self.transactions.len();
        Ok(())
    }

    /// Move the cursor back and return the transaction to reverse.
    pub fn undo(&mut self) -> Option<&Transaction> {
        if !self.can_undo() {
            return None;
        }
        self.cursor -= 1;
        self.transactions.get(self.cursor)
    }

    /// Return the next transaction to reapply and move the cursor forward.
    pub fn redo(&mut self) -> Option<&Transaction> {
        if !self.can_redo() {
            return None;
        }
        let transaction = self.transactions.get(self.cursor)?;
        self.cursor += 1;
        Some(transaction)
    }
}

fn escape_css_string(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '\\' => escaped.push_str("\\\\"),
            '"' => escaped.push_str("\\\""),
            '\n' => escaped.push_str("\\A "),
            '\r' => escaped.push_str("\\D "),
            '\0' => escaped.push_str("\\FFFD "),
            _ if ch.is_control() => escaped.push_str(&format!("\\{:X} ", ch as u32)),
            _ => escaped.push(ch),
        }
    }
    escaped
}

fn validate_width_value(value: &str) -> Result<(), &'static str> {
    if !value.is_ascii() {
        return Err("width must be a supported CSS length");
    }
    const KEYWORDS: [&str; 4] = ["auto", "min-content", "max-content", "fit-content"];
    if KEYWORDS.contains(&value) {
        return Ok(());
    }
    let suffixes = ["px", "rem", "em", "%", "vw", "vh"];
    let suffix = suffixes
        .iter()
        .find(|suffix| value.ends_with(**suffix))
        .ok_or("width must be a supported CSS length")?;
    let number = &value[..value.len() - suffix.len()];
    let parts: Vec<&str> = number.split('.').collect();
    let valid_syntax = parts.len() <= 2
        && !parts[0].is_empty()
        && parts[0].chars().all(|ch| ch.is_ascii_digit())
        && parts
            .get(1)
            .map(|fraction| !fraction.is_empty() && fraction.chars().all(|ch| ch.is_ascii_digit()))
            .unwrap_or(true);
    let valid_number = valid_syntax
        && number
            .parse::<f64>()
            .map(|parsed| parsed.is_finite() && parsed >= 0.0)
            .unwrap_or(false);
    if !valid_number {
        return Err("width must be a supported CSS length");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn identity() -> ElementIdentity {
        ElementIdentity {
            webview_id: "main".into(),
            inspector_id: Some("fullscreen.queue".into()),
            html_id: Some("queue".into()),
            semantic_selector: Some("button[aria-label=Queue]".into()),
            generated_id: None,
        }
    }

    fn width_transaction(id: &str, before: &str, after: &str) -> Transaction {
        Transaction {
            id: id.into(),
            label: None,
            operations: vec![StyleOperation::SetStyle {
                identity: identity(),
                property: "width".into(),
                before: Some(before.into()),
                after: Some(after.into()),
            }],
        }
    }

    fn responsive_transaction(
        id: &str,
        breakpoint: &str,
        before: Option<&str>,
        after: Option<&str>,
    ) -> Transaction {
        Transaction {
            id: id.into(),
            label: None,
            operations: vec![StyleOperation::SetResponsiveStyle {
                identity: identity(),
                property: "width".into(),
                breakpoint: breakpoint.into(),
                before: before.map(Into::into),
                after: after.map(Into::into),
            }],
        }
    }

    fn text_transaction(index: Option<usize>) -> Transaction {
        Transaction {
            id: "text".into(),
            label: Some("Edit text".into()),
            operations: match index {
                Some(text_index) => vec![StyleOperation::SetText {
                    identity: identity(),
                    before: "Chapter ".into(),
                    after: "Prologue ".into(),
                    text_index,
                }],
                None => serde_json::from_str(
                    r#"[{"operation":"set_text","identity":{"webview_id":"main","inspector_id":"fullscreen.queue","html_id":"queue","semantic_selector":null,"generated_id":null},"before":"Chapter ","after":"Prologue "}]"#,
                )
                .unwrap(),
            },
        }
    }

    #[test]
    fn text_index_defaults_to_the_first_run_for_older_histories() {
        let transaction = text_transaction(None);
        assert!(transaction.validate().is_ok());
        let StyleOperation::SetText { text_index, .. } = &transaction.operations[0] else {
            panic!("expected a text operation");
        };
        assert_eq!(*text_index, 0);
    }

    #[test]
    fn accepts_a_later_text_run_and_rejects_out_of_range_indexes() {
        let transaction = text_transaction(Some(2));
        assert!(transaction.validate().is_ok());
        assert!(text_transaction(Some(65)).validate().is_err());
    }

    #[test]
    fn preferred_selector_uses_inspector_id_first() {
        assert_eq!(
            identity().preferred_selector(),
            Some(("data-inspector-id", "fullscreen.queue"))
        );
    }

    #[test]
    fn undo_redo_and_new_commit_discard_redo_branch() {
        let mut history = EditHistory::default();
        history
            .commit(width_transaction("one", "55px", "44px"))
            .unwrap();
        assert_eq!(history.undo().map(|tx| tx.id.as_str()), Some("one"));
        assert_eq!(history.redo().map(|tx| tx.id.as_str()), Some("one"));
        assert_eq!(history.undo().map(|tx| tx.id.as_str()), Some("one"));
        history
            .commit(width_transaction("two", "55px", "48px"))
            .unwrap();
        assert!(!history.can_redo());
        assert_eq!(history.transactions().len(), 1);
        assert_eq!(history.transactions()[0].id, "two");
    }

    #[test]
    fn repeated_commits_with_the_same_id_form_one_transaction() {
        let mut history = EditHistory::default();
        history
            .commit(width_transaction("drag-1", "55px", "54px"))
            .unwrap();
        history
            .commit(width_transaction("drag-1", "54px", "44px"))
            .unwrap();
        assert_eq!(history.transactions().len(), 1);
        assert_eq!(
            history.overrides_css().unwrap(),
            "/* HardlyUI visual edits. Generated file; edit through HardlyUI. */\n[data-inspector-id=\"fullscreen.queue\"] {\n  width: 44px;\n}\n"
        );
        let tx = history.undo().unwrap();
        let StyleOperation::SetStyle { before, after, .. } = &tx.operations[0] else {
            panic!("expected a style operation");
        };
        assert_eq!(before.as_deref(), Some("55px"));
        assert_eq!(after.as_deref(), Some("44px"));
    }

    #[test]
    fn serializes_only_the_active_width_value_with_stable_identity() {
        let mut history = EditHistory::default();
        history
            .commit(width_transaction("one", "55px", "44px"))
            .unwrap();
        assert_eq!(
            history.overrides_css().unwrap(),
            "/* HardlyUI visual edits. Generated file; edit through HardlyUI. */\n[data-inspector-id=\"fullscreen.queue\"] {\n  width: 44px;\n}\n"
        );
        history.undo();
        assert_eq!(
            history.overrides_css().unwrap(),
            "/* HardlyUI visual edits. Generated file; edit through HardlyUI. */\n"
        );
    }

    #[test]
    fn rejects_width_values_that_could_inject_css() {
        let mut history = EditHistory::default();
        assert!(history
            .commit(width_transaction("one", "55px", "44px; color:red"))
            .is_err());
    }

    #[test]
    fn rejects_conflicting_stable_ids_across_webviews() {
        let mut history = EditHistory::default();
        history
            .commit(width_transaction("main", "55px", "44px"))
            .unwrap();
        let mut modal = width_transaction("modal", "55px", "48px");
        let StyleOperation::SetStyle { identity, .. } = &mut modal.operations[0] else {
            panic!("expected a style operation");
        };
        identity.webview_id = "modal".into();
        history.commit(modal).unwrap();
        assert!(history.overrides_css().is_err());
    }

    #[test]
    fn a_breakpoint_edit_emits_only_its_media_block() {
        let mut history = EditHistory::default();
        history
            .commit(responsive_transaction(
                "phone-width",
                "phone",
                Some("55px"),
                Some("44px"),
            ))
            .unwrap();
        assert_eq!(
            history.overrides_css().unwrap(),
            "/* HardlyUI visual edits. Generated file; edit through HardlyUI. */\n@media (max-width: 600px) {\n  [data-inspector-id=\"fullscreen.queue\"] {\n    width: 44px !important;\n  }\n}\n"
        );
    }

    #[test]
    fn each_breakpoint_keeps_its_own_query_and_undo_removes_only_its_own() {
        let mut history = EditHistory::default();
        history
            .commit(responsive_transaction(
                "phone-width",
                "phone",
                Some("55px"),
                Some("44px"),
            ))
            .unwrap();
        history
            .commit(responsive_transaction(
                "desktop-width",
                "desktop",
                Some("55px"),
                Some("66px"),
            ))
            .unwrap();
        // Emission order follows the breakpoint keys, so desktop precedes phone.
        assert_eq!(
            history.overrides_css().unwrap(),
            "/* HardlyUI visual edits. Generated file; edit through HardlyUI. */\n@media (min-width: 1025px) {\n  [data-inspector-id=\"fullscreen.queue\"] {\n    width: 66px !important;\n  }\n}\n@media (max-width: 600px) {\n  [data-inspector-id=\"fullscreen.queue\"] {\n    width: 44px !important;\n  }\n}\n"
        );
        history.undo();
        assert_eq!(
            history.overrides_css().unwrap(),
            "/* HardlyUI visual edits. Generated file; edit through HardlyUI. */\n@media (max-width: 600px) {\n  [data-inspector-id=\"fullscreen.queue\"] {\n    width: 44px !important;\n  }\n}\n"
        );
        history.redo();
        history.undo();
        history.undo();
        assert_eq!(
            history.overrides_css().unwrap(),
            "/* HardlyUI visual edits. Generated file; edit through HardlyUI. */\n"
        );
    }

    #[test]
    fn rejects_an_unsupported_breakpoint_and_injected_media_value() {
        assert!(responsive_transaction("watch", "watch", None, Some("44px"))
            .validate()
            .is_err());
        let mut history = EditHistory::default();
        assert!(history
            .commit(responsive_transaction("watch", "watch", None, Some("44px")))
            .is_err());
        assert!(history
            .commit(responsive_transaction(
                "phone-width",
                "phone",
                None,
                Some("44px; color:red"),
            ))
            .is_err());
        // A rejected commit must not leave a history entry behind.
        assert!(history.transactions().is_empty());
        assert_eq!(
            history.overrides_css().unwrap(),
            "/* HardlyUI visual edits. Generated file; edit through HardlyUI. */\n"
        );
    }

    #[test]
    fn rejects_conflicting_breakpoint_rules_for_one_selector_across_webviews() {
        let mut history = EditHistory::default();
        history
            .commit(responsive_transaction(
                "phone-width",
                "phone",
                Some("55px"),
                Some("44px"),
            ))
            .unwrap();
        let mut modal =
            responsive_transaction("modal-phone-width", "phone", Some("55px"), Some("48px"));
        let StyleOperation::SetResponsiveStyle { identity, .. } = &mut modal.operations[0] else {
            panic!("expected a responsive style operation");
        };
        identity.webview_id = "modal".into();
        history.commit(modal).unwrap();
        assert!(history.overrides_css().is_err());
        // Removing the other webview's declaration resolves the conflict.
        history.undo();
        assert!(history.overrides_css().is_ok());
    }

    #[test]
    fn rejects_a_selector_owned_by_another_webview_after_reset() {
        let mut history = EditHistory::default();
        history
            .commit(width_transaction("main", "55px", "44px"))
            .unwrap();
        let mut modal = width_transaction("modal", "55px", "44px");
        let StyleOperation::SetStyle {
            identity, after, ..
        } = &mut modal.operations[0]
        else {
            panic!("expected a style operation");
        };
        identity.webview_id = "modal".into();
        *after = None;
        history.commit(modal).unwrap();
        assert!(history.overrides_css().is_err());
    }
}
