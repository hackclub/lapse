export function ShelfHeader({ title, description, icon }: {
  title: string,
  description: string,
  icon: string
}) {
  return (
    <div className="flex items-center gap-4 w-full h-min">
      <img src={icon} alt="" className="block w-14 h-14" />

      <div className="flex flex-col">
        <h1 className="font-bold text-3xl">{title}</h1>
        <p className="text-lg sm:text-xl">{description}</p>
      </div>
    </div>
  );
}
