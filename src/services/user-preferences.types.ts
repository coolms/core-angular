/**
 * Shapes the user-preference store persists.
 *
 * {@link UserPreferencesService} owns ONE store (`coolms_ui_prefs`) with
 * several namespaces -- grids, panels, page state, nav, terminal -- so these
 * shapes are core's and the surfaces that read them are consumers. The datagrid
 * is simply the namespace with the richest shape.
 *
 * `shared/datagrid/datagrid-preferences.types` re-exports them, so the kit
 * keeps its own local path and nothing that reads a grid preference had to
 * change.
 */
export interface DataGridPreference {
    columns?:      string[];               // field names in display order
    columnWidths?: Record<string, number>; // field -> px width
}

export type DataGridPreferences = Record<string, DataGridPreference>;
