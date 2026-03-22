/**
 * Theme manager: type definitions for Light / Dark / System theme switching.
 *
 * Theme state is managed by useSettings (persisted in the unified "cf-settings"
 * localStorage key). This module provides only the shared Theme type.
 */

export type Theme = "light" | "dark" | "system";
