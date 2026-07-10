import type { CategoryRule, RuleField, RuleOperator } from './types';

export interface CategoryRuleSource {
	payee: string | null;
	description: string | null;
	note: string | null;
	searchText: string;
}

export interface CategoryRuleDraft {
	field: RuleField;
	operator: RuleOperator;
	pattern: string;
}

export function matchesCategoryRule(
	source: CategoryRuleSource,
	rule: Pick<CategoryRule, 'field' | 'operator' | 'pattern'> | CategoryRuleDraft
): boolean {
	const rawValue = ruleFieldValue(source, rule.field);
	const value = rawValue.toLowerCase();
	const pattern = rule.pattern.toLowerCase();
	switch (rule.operator) {
		case 'contains':
			return value.includes(pattern);
		case 'equals':
			return value === pattern;
		case 'starts_with':
			return value.startsWith(pattern);
		case 'regex':
			try {
				return new RegExp(rule.pattern, 'i').test(rawValue);
			} catch {
				return false;
			}
	}
}

function ruleFieldValue(source: CategoryRuleSource, field: RuleField): string {
	switch (field) {
		case 'payee':
			return source.payee ?? '';
		case 'description':
			return source.description ?? '';
		case 'note':
			return source.note ?? '';
		case 'search_text':
			return source.searchText;
	}
}
