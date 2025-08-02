import { Collection } from "tinacms";

const WheelSet: Collection = {
  name: "wheelset",
  label: "Wheels",
  path: "content/wheelset",
  fields: [
    {
      type: "string",
      name: "title",
      label: "Title",
      isTitle: true,
      required: true,
    },
    {
      type: "string",
      name: "description",
      label: "Description",
    },
    {
      type: "boolean",
      name: "draft",
      label: "Draft",
    },
    {
      type: "image",
      name: "bstormXML",
      label: "Brainstormer XML",
    },
  ],
};

export default WheelSet;
