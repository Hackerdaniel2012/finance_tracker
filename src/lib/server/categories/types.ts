export type CategoryType = 'income' | 'expense' | 'transfer' | 'investment' | 'unknown';
export type RuleField = 'payee' | 'description' | 'note' | 'search_text';
export type RuleOperator = 'contains' | 'equals' | 'starts_with' | 'regex';

export interface Category {
	id: string;
	name: string;
	type: CategoryType;
	color: string | null;
	icon: string | null;
	isDefault: boolean;
	sortOrder: number;
	createdAt: string;
	updatedAt: string;
}

export interface CategoryRule {
	id: string;
	categoryId: string;
	name: string;
	field: RuleField;
	operator: RuleOperator;
	pattern: string;
	priority: number;
	isGlobal: boolean;
	createdAt: string;
	updatedAt: string;
}

export interface CreateCategoryInput {
	name: string;
	type: CategoryType;
	color?: string | null;
	icon?: string | null;
	sortOrder?: number;
}

export interface UpdateCategoryInput {
	id: string;
	name?: string;
	type?: CategoryType;
	color?: string | null;
	icon?: string | null;
	sortOrder?: number;
}

export interface CreateCategoryRuleInput {
	categoryId: string;
	name: string;
	field: RuleField;
	operator: RuleOperator;
	pattern: string;
	priority?: number;
	isGlobal?: boolean;
}

export interface UpdateCategoryRuleInput {
	id: string;
	categoryId?: string;
	name?: string;
	field?: RuleField;
	operator?: RuleOperator;
	pattern?: string;
	priority?: number;
	isGlobal?: boolean;
}
