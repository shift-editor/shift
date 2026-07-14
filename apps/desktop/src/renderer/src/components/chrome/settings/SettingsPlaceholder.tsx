interface SettingsPlaceholderProps {
  title: string;
  description: string;
}

export const SettingsPlaceholder = ({ title, description }: SettingsPlaceholderProps) => (
  <section className="flex flex-col gap-2 p-5 pr-8">
    <h2 className="text-sm font-medium text-primary">{title}</h2>
    <p className="max-w-lg text-xs leading-5 text-secondary">{description}</p>
  </section>
);
