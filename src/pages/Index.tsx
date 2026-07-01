import { useTranslation } from "react-i18next";

const Index = () => {
  const { t } = useTranslation();

  return (
    <div className="relative flex h-full w-full flex-col bg-gradient-to-b from-[#4E54C8] to-[#A8C0FF] p-[32px] max-md:pb-[32px] max-md:pl-[20px] max-md:pr-[20px] max-md:pt-[32px]">
      <div className="text-[26px] text-white max-md:text-[22px]">
        {t("common.appName")}
      </div>
      <div className="flex h-full flex-1 flex-col items-center justify-center">
        <div className="text-center text-[48px] text-white max-md:text-[26px]">
          {t("home.hero.title")}
        </div>
        <div className="text-center text-[24px] text-white max-md:text-[16px]">
          {t("home.hero.subtitle")}
        </div>
      </div>
    </div>
  );
};

export default Index;
