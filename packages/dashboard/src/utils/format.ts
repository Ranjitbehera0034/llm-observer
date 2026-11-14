export const formatCurrency = (value: number | undefined | null) => {
    if (value === undefined || value === null || !Number.isFinite(value)) return 'Unpriced';
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 4,
    }).format(value);
};
