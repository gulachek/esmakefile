// OpenTelemetry names
// https://opentelemetry.io/docs/specs/semconv/general/naming/
//
// https://open-telemetry.github.io/opentelemetry-js/modules/_opentelemetry_semantic-conventions.html
// Exported constants follow this naming scheme:
//
// ATTR_${attributeName} for attributes
// ${attributeName}_VALUE_{$enumValue} for enumerations of attribute values
// METRIC_${metricName} for metric names
// EVENT_${eventName} for event names

export const ATTR_ARTIFACT_ID = 'esmakefile.artifact.id';

export const EVENT_RECIPE_BEGIN = 'esmakefile.recipe.begin';
export const EVENT_RECIPE_CHILD_PROCESS_OUTPUT =
	'esmakefile.recipe.child_process.output';
export const EVENT_RECIPE_CHILD_PROCESS_OUTPUT_UPLOAD_EXCEPTION =
	'esmakefile.recipe.child_process.output_upload_failed';
export const EVENT_RECIPE_EXCEPTION = 'esmakefile.recipe.exception';
export const EVENT_TARGET_STALE_NO_RECIPE = 'esmakefile.target.stale_no_recipe';

export const MIME_TYPE_ANSI_STREAM = 'application/x-ansi-terminal-stream';
export const EVENT_TARGET_UP_TO_DATE = 'esmakefile.target.up_to_date';
