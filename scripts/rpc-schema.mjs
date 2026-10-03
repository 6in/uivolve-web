import { create, createFileRegistry, toBinary } from "@bufbuild/protobuf";
import { FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";

// Descriptor generation for the small, dependency-free demo schema.
// Applications publish a Descriptor Set compiled from their own .proto files.
const fields = [
  { name: "name", number: 1, label: 1, type: 9 },
  { name: "sequence_id", jsonName: "sequenceId", number: 2, label: 1, type: 3 },
  { name: "payload", number: 3, label: 1, type: 12 },
];
export const descriptorSet = create(FileDescriptorSetSchema, {
  file: [
    {
      name: "rpc-demo.proto",
      package: "uivolve.demo",
      syntax: "proto3",
      messageType: [
        { name: "EchoRequest", field: fields },
        { name: "EchoResponse", field: fields },
      ],
      service: [
        {
          name: "EchoService",
          method: [
            {
              name: "Echo",
              inputType: ".uivolve.demo.EchoRequest",
              outputType: ".uivolve.demo.EchoResponse",
            },
          ],
        },
      ],
    },
  ],
});
export const descriptorBytes = toBinary(FileDescriptorSetSchema, descriptorSet);
export const registry = createFileRegistry(descriptorSet);
export const echoService = registry.getService("uivolve.demo.EchoService");
