/**
 * Model tiers — single source of truth for the tier slot list and metadata.
 *
 * Lives in its own module (imported by both model-mapping.js and
 * provider-presets.js) so the preset validator can accept the full tier key
 * set without creating an import cycle.
 *
 * Order matters: TIERS doubles as the display order in the model-mapping
 * page (tierOrder → settings API → UI rows). Slots:
 *   fable     — above flagship, Claude Code 5.x tier (display name: Frontier)
 *   flagship  — the provider's best general model
 *   reasoning — strongest reasoning-capable model
 *   standard  — the everyday workhorse
 *   fast      — cheap/quick responses
 *   default   — fallback for models that match no recognized tier
 */
export const TIERS = ['fable', 'flagship', 'reasoning', 'standard', 'fast', 'default'];

export const TIER_INFO = {
    fable: {
        label: 'Frontier',
        description: 'Above flagship — Claude Code 5.x "Fable" tier; usually maps to the same model as flagship.'
    },
    flagship: {
        label: 'Flagship',
        description: 'The provider\'s best general-purpose model.'
    },
    reasoning: {
        label: 'Reasoning',
        description: 'Strongest reasoning-capable model of the provider.'
    },
    standard: {
        label: 'Standard',
        description: 'The everyday workhorse — balanced quality and cost.'
    },
    fast: {
        label: 'Fast',
        description: 'Cheapest/quick responses for light work.'
    },
    default: {
        label: 'Default',
        description: 'Fallback for incoming models that match no recognized tier. Not auto-filled by discovery.'
    }
};
