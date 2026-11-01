export type CoursePrice = { label: string; price: number };
export type Course = {
  id: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  location: string;
  mode: string;
  image: string;
  description: string;
  instructor: string;
  instructorBio: string[];
  outline: string[];
  pricing: CoursePrice[];
};
