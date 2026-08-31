// Typed contract — mirrors FormRenderDefinition PHP VOs exactly.
// No `any` anywhere.

export type FieldType =
    | 'text' | 'email' | 'password' | 'number' | 'textarea'
    | 'select' | 'toggle' | 'date' | 'time' | 'hidden'
    | 'relation' | 'subform' | 'token-pattern' | 'richtext'
    | 'localizedText' | 'localizedTextarea' | 'optionsEditor'
    // Phone module: composite international phone field — country select
    // (localized via Intl.DisplayNames + dial codes from /api/v1/phone/countries)
    // + masked number input, composing a single E.164 string value.
    | 'intlPhone'
    // Swatch picker + hex box over one value, where EMPTY is meaningful
    // ("inherit the deployment's colour") rather than missing. Added for the
    // per-user admin accent; nothing about it is theming-specific.
    | 'color';

export type DataSourceType = 'static' | 'enum' | 'api' | 'repo';

export type VisibilityOperator = 'eq' | 'ne' | 'in' | 'notIn' | 'empty' | 'notEmpty';

export interface VisibilityCondition {
    readonly field:    string;
    readonly operator: VisibilityOperator;
    readonly value?:   unknown;
}

export type DataSourceWidget  = 'select' | 'select-search' | 'select-tree' | 'token-input' | 'media-picker';
export type DataSourceLoading = 'eager' | 'lazy';

export interface DataSourceOption {
    readonly value:     unknown;
    readonly label:     string;
    readonly parentId?: string | null; // select-tree: used for client-side tree building
}

export interface DataSourceDefinition {
    readonly type:      DataSourceType;
    readonly bindValue: string;
    readonly bindLabel: string;
    readonly multiple:  boolean;
    readonly maxItems?: number;
    readonly options?:  ReadonlyArray<DataSourceOption>;  // static + enum: resolved by backend
    readonly url?:      string;                           // api + repo: fetch at runtime
    readonly widget:    DataSourceWidget;                 // rendering strategy
    readonly loading:   DataSourceLoading;                // fetch strategy
    /** Free-form widget-specific configuration block populated from YAML
     *  `dataSource.widgetOptions`. Used by media-picker for bindTarget /
     *  display / accept / recentlyUsed / hoverPreview, and reserved for
     *  future custom widgets. Kept separate from `options` (which is the
     *  static-option list) to avoid key collisions. */
    readonly widgetOptions?: Readonly<Record<string, unknown>>;
}

export interface ValidatorDefinition {
    readonly type:     string;
    readonly value?:   unknown;
    readonly message?: string;
}

export interface RelationDefinition {
    readonly cardinality:   'one' | 'many';
    readonly maxItems?:     number;
    readonly targetFormId?: string;
    readonly dataSource?:   DataSourceDefinition;
}

export interface SubFormDefinition {
    readonly formId:    string;
    readonly relation:  'one' | 'many';
    readonly maxItems?: number;
}

export interface FieldSecurityPolicy {
    readonly read:  ReadonlyArray<string>;
    readonly write: ReadonlyArray<string>;
}

export interface FieldItem {
    readonly alias:        string;
    readonly type:         FieldType;
    readonly label:        string;
    readonly placeholder?: string;
    readonly hint?:        string;
    readonly required:     boolean;
    readonly readonly:     boolean;
    readonly locked:       boolean;
    readonly private:      boolean;
    readonly validators:   ReadonlyArray<ValidatorDefinition>;
    readonly dataSource?:  DataSourceDefinition;
    readonly relation?:    RelationDefinition;
    readonly subForm?:     SubFormDefinition;
    readonly separators?:  ReadonlyArray<string>; // token-pattern field: separator chars
    readonly security?:    FieldSecurityPolicy | null;
    readonly autocomplete?: string; // HTML autocomplete token (e.g. 'username', 'current-password')
}

export interface LayoutNode {
    // A layout container, or a field alias. The `& {}` is what keeps the five
    // names meaningful: a bare `| string` absorbs them, so the union listed
    // five options the compiler had already collapsed to `string` -- no
    // completion, no checking, just documentation that looked like a type.
    readonly type:                 'group' | 'grid' | 'column' | 'tabs' | 'tab' | (string & {});
    readonly name?:                string;
    readonly description?:         string;
    readonly compact?:             boolean;
    readonly width?:               number; // 1–12 grid columns
    readonly children?:            ReadonlyArray<LayoutNode>;
    readonly showWhen?: VisibilityCondition;
}

export type FormActionType    = 'submit' | 'button' | 'reset';
export type FormActionVariant = 'primary' | 'secondary' | 'danger' | 'link';

/** Terminal form button (Submit / Cancel / …) — mirrors PHP FormAction.
 *  Resolved by the backend (declared `formOptions.actions`, else lifted from
 *  legacy submit fields, else a default Submit). `label` is already translated. */
export interface FormAction {
    readonly type:    FormActionType;
    readonly label:   string;
    readonly name:    string;
    readonly variant: FormActionVariant;
}

export interface FormRenderDefinition {
    readonly id:      string;
    readonly context: 'create' | 'edit';
    readonly layout:  ReadonlyArray<LayoutNode>;
    readonly items:   ReadonlyArray<FieldItem>;
    readonly actions: ReadonlyArray<FormAction>;
    readonly action?: string; // declared submit target (formOptions.action)
}
